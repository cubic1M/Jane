import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { documentDates, policyForMerchant } from "./dates";
import { addDocument, openDocument, removeDocument, saveDocumentFacts } from "./store";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\nSECRET POLICY NUMBER 12345\n"), randomBytes(64)]);
const upload = (kind: "insurance_policy" | "warranty" | "receipt" = "insurance_policy") => ({
  file: { name: "policy.pdf", type: "application/pdf", size: PDF.length },
  bytes: PDF,
  kind,
});

function fakeClaude(fields: Record<string, string>) {
  const create = vi.fn(async () => ({
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          provider: "",
          policyType: "",
          coverageSummary: "",
          premium: "",
          premiumFrequency: "",
          renewalDate: "",
          warrantyEndsOn: "",
          purchaseDate: "",
          purchaseAmount: "",
          ...fields,
        }),
      },
    ],
  }));
  return (() => ({ messages: { create } })) as never;
}

describe.runIf(url)("documents against a real database (spec step 68)", () => {
  let client: PrismaClient;
  const ids: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `docs-${crypto.randomUUID()}@example.com` },
    });
    ids.push(user.id);
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.mocked(logAudit).mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  it("keeps the file encrypted and stores what Claude read", async () => {
    const userId = await person();
    const claude = fakeClaude({
      provider: "GEICO",
      policyType: "auto",
      coverageSummary: "Covers two cars.",
      premium: "612",
      premiumFrequency: "semiannual",
      renewalDate: "2027-03-01",
    });

    const result = await addDocument(userId, upload(), { client, claude });

    expect(result).toMatchObject({ ok: true, read: "claude", summaryRejected: false });
    const row = await client.document.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({
      provider: "GEICO",
      premiumCents: 61_200,
      extractionSource: "claude",
      contentType: "application/pdf",
      sizeBytes: PDF.length,
    });
    expect(Buffer.from(row.encryptedBytes).includes(Buffer.from("SECRET POLICY"))).toBe(false);
    expect(vi.mocked(logAudit).mock.calls.map((c) => c[1])).toEqual([
      "document_uploaded",
      "document_read",
    ]);
    // The audit log names the kind and size, never the file's name or contents.
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toMatch(/policy\.pdf|GEICO|SECRET/);
  });

  it("keeps the file with no facts when Claude isn't set up, for the person to fill in", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const userId = await person();

    const result = await addDocument(userId, upload(), { client });

    expect(result).toMatchObject({ ok: true, read: "you" });
    const row = await client.document.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({ extractionSource: "none", provider: null });

    const saved = await saveDocumentFacts(
      userId,
      row.id,
      { provider: "Allstate", premiumCents: "95.50", premiumFrequency: "monthly" },
      { client },
    );
    expect(saved).toEqual({ ok: true });
    expect(await client.document.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      provider: "Allstate",
      premiumCents: 9_550,
      extractionSource: "you",
    });
  });

  it("refuses a file that isn't what it claims", async () => {
    const userId = await person();
    const fake = Buffer.from("<html></html>");
    const result = await addDocument(
      userId,
      {
        file: { name: "x.pdf", type: "application/pdf", size: fake.length },
        bytes: fake,
        kind: "other",
      },
      { client, claude: fakeClaude({}) },
    );
    expect(result).toEqual({ ok: false, error: "Upload a PDF, JPEG, PNG or WebP file." });
    expect(await client.document.count({ where: { userId } })).toBe(0);
  });

  it("opens, corrects and deletes a file only for its owner", async () => {
    const owner = await person();
    const stranger = await person();
    const added = await addDocument(owner, upload(), { client, claude: fakeClaude({}) });
    if (!added.ok) throw new Error("upload failed");

    expect(await openDocument(stranger, added.id, { client })).toBeNull();
    expect(
      await saveDocumentFacts(stranger, added.id, { provider: "x" }, { client }),
    ).toMatchObject({
      ok: false,
    });
    expect(await removeDocument(stranger, added.id, { client })).toBe(false);

    const opened = await openDocument(owner, added.id, { client });
    expect(opened?.bytes.equals(PDF)).toBe(true);
    expect(opened).toMatchObject({ fileName: "policy.pdf", contentType: "application/pdf" });
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: owner }, "document_viewed", {
      type: "document",
      id: added.id,
    });

    expect(await removeDocument(owner, added.id, { client })).toBe(true);
    expect(await client.document.count({ where: { id: added.id } })).toBe(0);
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: owner }, "document_deleted", {
      type: "document",
      id: added.id,
    });
  });

  it("lists every date the person's documents carry, soonest first", async () => {
    const userId = await person();
    const other = await person();
    const base = { contentType: "application/pdf", sizeBytes: 1, encryptedBytes: Buffer.from("x") };
    const [policy, warranty, receipt] = await Promise.all(
      [
        {
          kind: "insurance_policy",
          fileName: "p.pdf",
          provider: "GEICO",
          policyType: "auto",
          renewalDate: new Date("2027-03-01"),
        },
        {
          kind: "warranty",
          fileName: "w.pdf",
          provider: "Dyson",
          warrantyEndsOn: new Date("2028-06-15"),
          purchaseDate: new Date("2026-06-15"),
        },
        { kind: "receipt", fileName: "receipt.jpg", purchaseDate: new Date("2026-10-10") },
      ].map((d) => client.document.create({ data: { ...base, ...d, userId } })),
    );
    await client.document.create({
      data: { ...base, userId, kind: "other", fileName: "note.pdf" },
    });
    await client.document.create({
      data: {
        ...base,
        userId: other,
        kind: "insurance_policy",
        fileName: "theirs.pdf",
        renewalDate: new Date("2026-11-01"),
      },
    });

    expect(await documentDates(userId, { client })).toEqual([
      {
        documentId: receipt.id,
        kind: "receipt",
        title: "receipt.jpg",
        date: "2026-11-09",
        what: "return_window",
      },
      {
        documentId: policy.id,
        kind: "insurance_policy",
        title: "GEICO car insurance",
        date: "2027-03-01",
        what: "renewal",
      },
      {
        documentId: warranty.id,
        kind: "warranty",
        title: "Dyson",
        date: "2028-06-15",
        what: "warranty_end",
      },
    ]);
  });

  it("finds the policy behind an insurance card", async () => {
    const userId = await person();
    const base = { contentType: "application/pdf", sizeBytes: 1, encryptedBytes: Buffer.from("x") };
    const policy = await client.document.create({
      data: {
        ...base,
        userId,
        kind: "insurance_policy",
        fileName: "p.pdf",
        provider: "State Farm Mutual Automobile Insurance Company",
        renewalDate: new Date("2027-03-01"),
        premiumCents: 61_200,
        premiumFrequency: "semiannual",
      },
    });
    await client.document.create({
      data: { ...base, userId, kind: "receipt", fileName: "r.pdf", provider: "State Farm" },
    });

    expect(await policyForMerchant(userId, "STATE FARM INSURANCE", { client })).toEqual({
      documentId: policy.id,
      renewalDate: "2027-03-01",
      premiumCents: 61_200,
      premiumFrequency: "semiannual",
    });
    expect(await policyForMerchant(userId, "GEICO", { client })).toBeNull();
    expect(await policyForMerchant(await person(), "State Farm", { client })).toBeNull();
  });
});
