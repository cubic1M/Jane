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
import {
  NoticeError,
  chooseResponse,
  confirmTaxNotice,
  readTaxNotice,
  sendResponse,
} from "@/lib/tax-notices";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 217 against a real, migrated Postgres: an uploaded IRS notice is read for the
// person to confirm, its date goes on their deadlines, it's checked against their records,
// a reply is drafted, and nothing is sent until they choose who sends it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("tax notices against a real database", { timeout: 120_000 }, () => {
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
    // Freelance income from a client, and a tax payment.
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2025-06-10T00:00:00Z"),
        amountCents: -900_000,
        description: "ACME FREELANCE LLC",
        merchantName: "ACME FREELANCE LLC",
        pfcDetailed: "INCOME_CONTRACTOR",
      },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2025-04-15T00:00:00Z"),
        amountCents: 150_000,
        description: "IRS USATAXPYMT",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
      },
    });
    const document = await client.document.create({
      data: {
        userId: user.id,
        kind: "tax_notice",
        fileName: "cp2000.jpg",
        contentType: "image/jpeg",
        sizeBytes: 3,
        encryptedBytes: Buffer.from("abc"),
      },
    });
    return { userId: user.id, documentId: document.id };
  }
  const gather = async (userId: string) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now: LINKED }))!, context);

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

  it("reads the upload for the person to confirm, and puts nothing on the deadlines before", async () => {
    const { userId, documentId } = await person("notice");
    const reading = (await readTaxNotice(userId, documentId, { client, now: LINKED }))!;
    expect(reading.status).toBe("waiting");
    expect((await readTaxNotice(userId, documentId, { client, now: LINKED }))!.id).toBe(reading.id);
    await expect(
      confirmTaxNotice(userId, reading.id, { client, now: LINKED }),
    ).rejects.toBeInstanceOf(NoticeError);
    expect(
      await client.deadline.count({ where: { userId, title: { startsWith: "Respond to your" } } }),
    ).toBe(0);
    const message = (await gather(userId)).find((c) => c.dedupeKey === `notice:${reading.id}`)!;
    expect(message.body).toBe(
      "I couldn't read all of cp2000.jpg. Fill in the rest and confirm, and I'll put its date on your deadlines.",
    );
  });

  it("confirms with its deadline, checks it against the records, drafts a reply, and sends only on a tap", async () => {
    const { userId, documentId } = await person("notice-flow");
    const reading = (await readTaxNotice(userId, documentId, { client, now: LINKED }))!;
    await expect(
      chooseResponse(userId, reading.id, "agree", { client, now: LINKED }),
    ).rejects.toThrow("Confirm what's on the notice first.");
    const notice = await confirmTaxNotice(userId, reading.id, {
      client,
      now: LINKED,
      fields: {
        kind: "CP2000",
        issuer: "irs",
        taxYear: "2025",
        noticeDate: "2026-10-10",
        amount: "1,100",
        payer: "Acme Freelance LLC",
        reportedIncome: "9,000",
        reason: "Income from Acme Freelance LLC wasn't on your return.",
      },
    });
    expect(notice.dueOn).toBe("2026-11-09");
    expect(notice.sources.kind).toBe("you");
    expect(
      await client.deadline.count({
        where: {
          userId,
          title: "Respond to your CP2000 notice",
          dueOn: new Date("2026-11-09T00:00:00Z"),
        },
      }),
    ).toBe(1);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_notice_confirmed",
      { type: "document", id: documentId },
      { kind: "CP2000" },
    );

    // The chat explains it, with what Jane found, and offers the replies.
    const open = (await gather(userId)).find((c) =>
      c.dedupeKey.startsWith(`notice-open:${reading.id}`),
    )!;
    expect(open.body).toContain("CP2000: proposed changes to your return: $1,100.00 proposed.");
    expect(open.body).toContain("Your accounts show ACME FREELANCE LLC paid you $9,000.00.");
    expect(open.body).toContain("Nothing is paid or sent until you tap.");
    expect(open.refs.advice).toBe(true);
    expect(parseActions(open.actions).map((a) => a.id)).toEqual([
      "tax.notice_agree",
      "tax.notice_dispute",
      "open",
    ]);

    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: open.kind,
        body: open.body,
        refs: open.refs,
        actions: open.actions,
        dedupeKey: `taxes:${open.dedupeKey}`,
      },
    });
    await takeChatAction(userId, message.id, "tax.notice_agree", { client, now: LINKED });
    const drafted = (await gather(userId)).find(
      (c) => c.dedupeKey === `notice-draft:${reading.id}:agree`,
    )!;
    expect(drafted.body).toContain("agree with the proposed changes of $1,100");
    expect(drafted.body).toContain("[Your name]");
    // Drafted, not sent.
    expect((await client.taxNotice.findFirstOrThrow({ where: { userId } })).handledBy).toBeNull();

    const draftMessage = await client.janeMessage.create({
      data: {
        userId,
        kind: drafted.kind,
        body: drafted.body,
        refs: drafted.refs,
        actions: drafted.actions,
        dedupeKey: `taxes:${drafted.dedupeKey}`,
      },
    });
    const after = (
      await takeChatAction(userId, draftMessage.id, "tax.notice_team", { client, now: LINKED })
    ).message;
    expect(after.refs.note).toBe("Done: Jane's team has it and will send it.");
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_notice_response_sent",
      { type: "document", id: documentId },
      { response: "agree", by: "team" },
    );
    await expect(sendResponse(userId, reading.id, "you", { client, now: LINKED })).rejects.toThrow(
      "already been sent",
    );
    expect((await gather(userId)).some((c) => c.dedupeKey.startsWith("notice-"))).toBe(false);

    const { reply } = await sendToJane(userId, "I got a letter from the IRS", {
      client,
      now: LINKED,
    });
    expect(reply.body).toContain("You have 1 tax notice on file.");
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_notices", {}, { client, now: LINKED })).content,
    );
    expect(tool.notices[0]).toMatchObject({
      looksLike: "agree",
      reply: "sent by Jane's team",
      dueBy: "2026-11-09",
    });
  });

  it("points a balance already paid to disagreeing with proof, and offers only replies that fit", async () => {
    const { userId, documentId } = await person("notice-paid");
    const reading = (await readTaxNotice(userId, documentId, { client, now: LINKED }))!;
    await confirmTaxNotice(userId, reading.id, {
      client,
      now: LINKED,
      fields: {
        kind: "CP14",
        issuer: "irs",
        taxYear: "2025",
        noticeDate: "2026-10-10",
        amount: "1,500",
      },
    });
    const open = (await gather(userId)).find((c) =>
      c.dedupeKey.startsWith(`notice-open:${reading.id}`),
    )!;
    expect(open.body).toContain("You paid $1,500.00 to IRS USATAXPYMT on 2025-04-15.");
    expect(parseActions(open.actions).map((a) => a.id)).toEqual([
      "tax.notice_dispute",
      "tax.notice_pay",
      "open",
    ]);
    await expect(
      chooseResponse(userId, reading.id, "agree", { client, now: LINKED }),
    ).rejects.toThrow("isn't a response to this kind of notice");
    const disputed = await chooseResponse(userId, reading.id, "dispute", { client, now: LINKED });
    expect(disputed.draft).toContain("Proof of payment: IRS USATAXPYMT, 2025-04-15");
  });

  it("shows no recommendation for real accounts, who still get the deadline and the draft", async () => {
    const real = await client.user.create({
      data: { email: `notice-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    const account = await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    void account;
    const document = await client.document.create({
      data: {
        userId: real.id,
        kind: "tax_notice",
        fileName: "n.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        encryptedBytes: Buffer.from("abc"),
      },
    });
    const reading = (await readTaxNotice(real.id, document.id, { client, now: LINKED }))!;
    await confirmTaxNotice(real.id, reading.id, {
      client,
      now: LINKED,
      fields: {
        kind: "CP14",
        issuer: "irs",
        taxYear: "2025",
        noticeDate: "2026-10-10",
        amount: "500",
      },
    });
    const open = (
      await taxesSource.gather((await loadSnapshot(real.id, { client, now: LINKED }))!, context)
    ).find((c) => c.dedupeKey.startsWith("notice-open:"))!;
    expect(open.refs.advice).toBeUndefined();
    expect(open.body).not.toContain("Nothing I can see");
  });
});
