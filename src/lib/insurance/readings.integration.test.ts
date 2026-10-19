import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { closeAnsweredElsewhere } from "@/lib/jane-agent/settled";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { listPolicies } from "./policies";
import {
  ReadingError,
  confirmReading,
  dismissReading,
  listReadings,
  readPolicyDocument,
  readingsFromDocuments,
} from "./readings";

// Policies read from documents against a real, migrated Postgres (spec step 151): what's
// read waits for the confirm tap; every field says where it came from; without a key the
// fields come from the person's payments; a renewal notice updates the policy on file.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");
const PDF = {
  bytes: new Uint8Array(Buffer.from("%PDF-1.7\n")),
  contentType: "application/pdf" as const,
};

function fakeClaude(fields: Record<string, string>) {
  const create = vi.fn(async () => ({
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          deductible: "",
          bodilyInjuryPerPerson: "",
          bodilyInjuryPerAccident: "",
          propertyDamage: "",
          collision: "",
          comprehensive: "",
          uninsuredMotorist: "",
          ...fields,
        }),
      },
    ],
  }));
  return (() => ({ messages: { create } })) as never;
}

describe.runIf(url)("policies read from documents against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const opts = () => ({ client, now: NOW });

  async function person() {
    const user = await client.user.create({
      data: { email: `ins-read-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  const policyDocument = (userId: string, facts: Record<string, unknown> = {}) =>
    client.document.create({
      data: {
        userId,
        kind: "insurance_policy",
        fileName: "declarations.pdf",
        contentType: "application/pdf",
        sizeBytes: 9,
        encryptedBytes: Buffer.from("x"),
        provider: "GEICO",
        policyType: "auto",
        premiumCents: 61_200,
        premiumFrequency: "semiannual",
        renewalDate: new Date("2027-03-01T00:00:00Z"),
        extractionSource: "claude",
        ...facts,
      },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("reads a declarations page for the confirm tap, saving nothing before it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const me = await person();
    const doc = await policyDocument(me);
    const reading = await readPolicyDocument(me, doc.id, {
      ...opts(),
      file: PDF,
      claude: fakeClaude({ deductible: "500", bodilyInjuryPerPerson: "100000", collision: "yes" }),
    });
    expect(reading).toMatchObject({
      status: "waiting",
      policyId: null,
      title: "GEICO car insurance",
      sources: {
        kind: "document",
        carrier: "document",
        premium: "document",
        deductible: "document",
        "coverage.bodilyInjuryPerPerson": "document",
        "coverage.collision": "document",
        renewalDate: "document",
      },
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: me },
      "document_read",
      { type: "document", id: doc.id },
      expect.objectContaining({ cover_limits: true }),
    );
    // Read once.
    expect((await readPolicyDocument(me, doc.id, opts()))?.id).toBe(reading!.id);
    expect(await listPolicies(me, opts())).toEqual([]);

    const other = await person();
    await expect(confirmReading(other, reading!.id, opts())).rejects.toThrow(ReadingError);
    const policyId = await confirmReading(me, reading!.id, opts());
    const [policy] = await listPolicies(me, opts());
    expect(policy).toMatchObject({
      id: policyId,
      kind: "auto",
      carrier: "GEICO",
      source: "document",
      status: "active",
      premiumCents: 61_200,
      premiumFrequency: "semiannual",
      deductibleCents: 50_000,
      coverage: { bodilyInjuryPerPerson: 10_000_000, collision: true },
      renewalDate: "2027-03-01",
      documentId: doc.id,
    });
    await expect(confirmReading(me, reading!.id, opts())).rejects.toThrow(
      "That one's already been answered.",
    );
  });

  it("prefills from the payments without a key, confirming the policy they found", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const me = await person();
    const found = await client.insurancePolicy.create({
      data: {
        userId: me,
        kind: "auto",
        carrier: "GEICO",
        source: "payments",
        status: "found",
        premiumCents: 10_200,
        premiumFrequency: "monthly",
        merchantKey: "geico",
      },
    });
    const doc = await policyDocument(me, {
      provider: null,
      policyType: null,
      premiumCents: null,
      premiumFrequency: null,
      renewalDate: null,
      extractionSource: "none",
    });
    // Not read with a file: Claude isn't asked.
    expect(await readingsFromDocuments(me, opts())).toBe(1);
    const [reading] = await listReadings(me, opts());
    expect(reading).toMatchObject({
      documentId: doc.id,
      policyId: found.id,
      input: { kind: "auto", carrier: "GEICO", premium: "102.00", premiumFrequency: "monthly" },
      sources: {
        kind: "payments",
        carrier: "payments",
        premium: "payments",
        premiumFrequency: "payments",
      },
    });
    await confirmReading(me, reading.id, opts());
    const policies = await listPolicies(me, opts());
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({ id: found.id, status: "active", documentId: doc.id });
  });

  it("updates the policy on file from a renewal notice, as the person corrected it", async () => {
    const me = await person();
    const old = await policyDocument(me);
    await readingsFromDocuments(me, opts());
    const [first] = await listReadings(me, opts());
    await confirmReading(me, first.id, opts());
    const [policy] = await listPolicies(me, opts());
    await client.insurancePolicy.update({
      where: { id: policy.id },
      data: { deductibleCents: 100_000 },
    });

    const notice = await policyDocument(me, {
      premiumCents: 70_000,
      renewalDate: new Date("2027-09-01T00:00:00Z"),
    });
    await readingsFromDocuments(me, opts());
    const reading = (await listReadings(me, { ...opts(), status: "waiting" }))[0];
    expect(reading).toMatchObject({
      documentId: notice.id,
      policyId: policy.id,
      input: { premium: "700.00", deductible: "1000.00", renewalDate: "2027-09-01" },
      sources: { premium: "document", deductible: "policy", renewalDate: "document" },
    });
    await confirmReading(me, reading.id, {
      ...opts(),
      input: { ...reading.input, premium: "690.00" },
    });
    const policies = await listPolicies(me, opts());
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      id: policy.id,
      premiumCents: 69_000,
      deductibleCents: 100_000,
      renewalDate: "2027-09-01",
      documentId: notice.id,
    });
    expect(await client.insurancePolicy.count({ where: { documentId: old.id } })).toBe(0);
  });

  it("leaves a dismissed reading off, and never reads it again", async () => {
    const me = await person();
    await policyDocument(me);
    await readingsFromDocuments(me, opts());
    const [reading] = await listReadings(me, opts());
    await dismissReading(me, reading.id, opts());
    expect(await readingsFromDocuments(me, opts())).toBe(0);
    expect(await listPolicies(me, opts())).toEqual([]);
    await expect(dismissReading(me, reading.id, opts())).rejects.toThrow(ReadingError);
  });

  it("asks in the chat with one Confirm, closes once confirmed elsewhere, and answers", async () => {
    const me = await person();
    await client.account.create({
      data: {
        userId: me,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await policyDocument(me);
    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const message = (await client.janeMessage.findMany({ where: { userId: me } })).find(
      (m) => parseRefs(m.refs).readingId,
    );
    expect(message?.body.split("\n")[0]).toBe("I read your GEICO car policy. Is this right?");
    expect(message?.body).toContain("- Price: $612.00 every 6 months (from the document)");
    const { message: answered } = await takeChatAction(me, message!.id, "reading.confirm", {
      client,
      now: NOW,
    });
    expect(answered).toMatchObject({ status: "answered", answeredWith: "Confirm" });
    expect((await listPolicies(me, opts())).map((p) => p.carrier)).toEqual(["GEICO"]);

    // A second document, confirmed on the page: its chat message loses its buttons.
    await policyDocument(me, { provider: "Lemonade", policyType: "renters" });
    await runJaneAgent(me, { client, now: new Date(NOW.getTime() + 86_400_000), trigger: "open" });
    const asked = (
      await client.janeMessage.findMany({ where: { userId: me, status: "open" } })
    ).find((m) => m.body.startsWith("I read your Lemonade renters policy"));
    expect(asked).toBeDefined();
    const { reply } = await sendToJane(me, "did you read my policy", { client, now: NOW });
    expect(reply.body.split("\n")[0]).toBe("I read your Lemonade renters policy. Is this right?");
    const tool = JSON.parse(
      (await runChatTool(me, "insurance_documents", {}, { client, now: NOW })).content,
    );
    expect(tool.documents.map((d: { status: string }) => d.status)).toEqual([
      "confirmed",
      "waiting for them to confirm",
    ]);

    const waiting = parseRefs(asked!.refs).readingId!;
    await confirmReading(me, waiting, opts());
    expect(await closeAnsweredElsewhere(me, { client, now: NOW })).toBeGreaterThanOrEqual(1);
    expect((await client.janeMessage.findUnique({ where: { id: asked!.id } }))?.status).toBe(
      "answered",
    );
  });
});
