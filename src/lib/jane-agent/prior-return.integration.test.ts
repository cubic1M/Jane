import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { PriorReturnError, confirmPriorReturn, readPriorReturn } from "@/lib/prior-return";
import { loadReturnReviews } from "@/lib/prior-return/review";
import { AmendmentError, prepareAmendment, signAmendment } from "@/lib/tax-amendment";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 172 against a real, migrated Postgres: an uploaded 2025 return is read for the
// person to confirm, reviewed against their accounts, and an amended return is prepared
// through the filing stand-in. Nothing is used before the confirm, nothing amended before
// the review and signature.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("last year's return against a real database", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    // Tuition paid in 2025.
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2025-08-20T00:00:00Z"),
        amountCents: 400_000,
        description: "STATE UNIVERSITY BURSAR",
        merchantName: "State University",
        pfcDetailed: "GENERAL_SERVICES_EDUCATION",
      },
    });
    const document = await client.document.create({
      data: {
        userId: user.id,
        kind: "tax_return",
        fileName: "2025-return.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        encryptedBytes: Buffer.from("abc"),
      },
    });
    return { userId: user.id, documentId: document.id };
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("reads the upload for the person to confirm, and uses nothing before they do", async () => {
    const { userId, documentId } = await person("prior");
    const reading = (await readPriorReturn(userId, documentId, { client, now: LINKED }))!;
    // Without a key nothing is read off the document; how they filed comes from the profile.
    expect(reading.status).toBe("waiting");
    expect(reading.fields.taxYear).toBeUndefined();
    expect((await loadReturnReviews(userId, { client, now: LINKED })).reviews).toEqual([]);
    // Read once.
    expect((await readPriorReturn(userId, documentId, { client, now: LINKED }))!.id).toBe(
      reading.id,
    );

    // Not enough to confirm.
    await expect(
      confirmPriorReturn(userId, reading.id, { client, now: LINKED }),
    ).rejects.toBeInstanceOf(PriorReturnError);
    const message = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === `prior:${reading.id}`)!;
    expect(message.body).toBe(
      "I couldn't read all of 2025-return.pdf. Fill in the rest and confirm, and I'll check it against your accounts.",
    );
    expect(message.actions.map((a) => a.id)).toEqual(["open", "tax.prior_no"]);
  });

  it("reviews a confirmed return against the accounts, and prepares an amended return to sign", async () => {
    const { userId, documentId } = await person("prior-amend");
    const reading = (await readPriorReturn(userId, documentId, { client, now: LINKED }))!;
    const confirmed = await confirmPriorReturn(userId, reading.id, {
      client,
      now: LINKED,
      fields: {
        taxYear: "2025",
        filingStatus: "single",
        deductionKind: "itemized",
        agi: "60000",
        totalTax: "6000",
        refund: "200",
      },
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.sources.taxYear).toBe("you");
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_return_read_confirmed",
      { type: "document", id: documentId },
      { year: 2025 },
    );

    const { reviews } = await loadReturnReviews(userId, { client, now: LINKED });
    const review = reviews[0];
    expect(review.year).toBe(2025);
    expect(review.findings.map((f) => f.key)).toContain("education_credit");
    expect(review.amendBy).toBe("2029-04-15");
    expect(review.worthAmending).toBe(true);

    // The chat brings it up with a button.
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === "review-return:2025:open")!;
    expect(candidate.body).toContain("An education credit wasn't claimed: about $");
    expect(candidate.actions.map((a) => a.id)).toEqual(["tax.amend_prepare", "open"]);
    expect(candidate.refs.advice).toBe(true);
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
    const after = (
      await takeChatAction(userId, message.id, "tax.amend_prepare", { client, now: LINKED })
    ).message;
    expect(after.refs.note).toBe(
      "Done: your 2025 amended return is ready. Review and sign it on Last year's return; nothing is sent until you do.",
    );
    expect(await client.taxAmendment.findFirstOrThrow({ where: { userId } })).toMatchObject({
      status: "ready_for_review",
      signedAt: null,
      submittedAt: null,
    });
    await expect(
      prepareAmendment(userId, 2025, { client, now: LINKED, via: "page" }),
    ).rejects.toThrow("already started");

    // Nothing is amended without the review and the signature.
    await expect(
      signAmendment(
        userId,
        { year: 2025, reviewed: false, signature: "Alex Rivera" },
        { client, now: LINKED },
      ),
    ).rejects.toThrow("Tick that you've reviewed");
    await expect(
      signAmendment(
        userId,
        { year: 2025, reviewed: true, signature: "Alex" },
        { client, now: LINKED },
      ),
    ).rejects.toBeInstanceOf(AmendmentError);
    expect((await client.taxAmendment.findFirstOrThrow({ where: { userId } })).status).toBe(
      "ready_for_review",
    );
    const signed = await signAmendment(
      userId,
      { year: 2025, reviewed: true, signature: "Alex  Rivera" },
      { client, now: LINKED },
    );
    expect(signed).toMatchObject({ status: "submitted", signerName: "Alex Rivera" });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_amendment_signed",
      { type: "tax_amendment", id: signed.id },
      { year: 2025 },
    );
    await expect(
      signAmendment(
        userId,
        { year: 2025, reviewed: true, signature: "Alex Rivera" },
        { client, now: LINKED },
      ),
    ).rejects.toThrow("already been signed");

    const { reply } = await sendToJane(userId, "did I miss anything on my return", {
      client,
      now: LINKED,
    });
    expect(reply.body).toContain("Looking at your 2025 return against your accounts");
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_last_return", {}, { client, now: LINKED })).content,
    );
    expect(tool.returns[0]).toMatchObject({
      taxYear: 2025,
      amendedReturn: { status: "submitted" },
    });
  });

  it("is not offered to real accounts", async () => {
    const real = await client.user.create({
      data: { email: `prior-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    expect(await loadReturnReviews(real.id, { client, now: LINKED })).toEqual({
      advice: false,
      reviews: [],
    });
    await expect(
      prepareAmendment(real.id, 2025, { client, now: LINKED, via: "page" }),
    ).rejects.toBeInstanceOf(AmendmentError);
  });
});
