import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { GivingError, loadGiving, openDonorFund } from "@/lib/giving";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { estimateTaxes } from "@/planning/tax-estimate";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 168 against a real, migrated Postgres: the demo person gave $3,000 to the Red
// Cross in September. Jane asks for its receipt, and in November shows bunching, a
// donor-advised fund and giving shares as the tax with and without each (demo advice).

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const NOVEMBER = new Date("2026-11-10T16:00:00Z");

describe.runIf(url)("giving, done smart, against a real database", { timeout: 120_000 }, () => {
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

  async function generousPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    const gift = await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-09-12T00:00:00Z"),
        amountCents: 300_000,
        description: "AMERICAN RED CROSS",
        merchantName: "American Red Cross",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      },
    });
    return { userId: user.id, giftId: gift.id };
  }
  const gather = async (userId: string, now = NOVEMBER) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now }))!, {
      now,
      local: { date: now.toISOString().slice(0, 10), hour: 8 },
      trigger: "open",
    });
  async function post(userId: string, dedupeKey: string, now = NOVEMBER) {
    const candidate = (await gather(userId, now)).find((c) => c.dedupeKey === dedupeKey);
    expect(candidate, dedupeKey).toBeDefined();
    return client.janeMessage.create({
      data: {
        userId,
        kind: candidate!.kind,
        body: candidate!.body,
        refs: candidate!.refs,
        actions: candidate!.actions,
        dedupeKey: `taxes:${dedupeKey}`,
      },
    });
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

  it("finds the gifts and shows each option as the tax with and without it", async () => {
    const { userId, giftId } = await generousPerson("giving");
    const view = await loadGiving(userId, { client, now: NOVEMBER });
    expect(view.totalCents).toBe(310_000);
    expect(view.gifts.find((g) => g.transactionId === giftId)).toMatchObject({
      payee: "American Red Cross",
      needsReceipt: true,
      receipted: false,
    });
    expect(view.receiptsMissing.map((g) => g.transactionId)).toEqual([giftId]);
    expect(view.inSeason).toBe(true);
    expect(view.options.map((o) => o.key)).toContain("bunch");
    // Every option's two figures, from the estimate engine.
    const { loadTaxEstimate } = await import("@/lib/tax-estimate");
    const input = (await loadTaxEstimate(userId, { client, now: NOVEMBER })).input;
    const tax = (charity: number) =>
      estimateTaxes({ ...input, charityCents: charity }).totalTaxCents;
    const bunch = view.options.find((o) => o.key === "bunch")!;
    expect(bunch.withoutCents).toBe(tax(310_000) * 2);
    expect(bunch.withCents).toBe(tax(620_000) + tax(0));
    for (const o of view.options) {
      expect(o.savesCents, o.key).toBe(o.withoutCents - o.withCents);
      expect(o.savesCents, o.key).toBeGreaterThan(0);
    }
  });

  it("asks for the receipt, and I have it records it", async () => {
    const { userId, giftId } = await generousPerson("giving-receipt");
    const message = await post(userId, `receipt:${giftId}`, LINKED);
    expect(message.body).toBe(
      "Your $3,000.00 gift to American Red Cross on Sep 12 needs a written receipt from them to count on your taxes. Have you got it?",
    );
    const after = (
      await takeChatAction(userId, message.id, "tax.receipt_got", { client, now: LINKED })
    ).message;
    expect(after.refs.note).toBe(
      "Got it: your gift to American Red Cross has its receipt. Keep it with your tax papers.",
    );
    expect((await loadGiving(userId, { client, now: LINKED })).receiptsMissing).toEqual([]);
  });

  it("brings the options up in November and opens a donor-advised fund, moving nothing", async () => {
    const { userId } = await generousPerson("giving-fund");
    // Not before the giving season.
    expect((await gather(userId, LINKED)).some((c) => c.dedupeKey === "giving:2026")).toBe(false);
    const message = await post(userId, "giving:2026");
    expect(message.body).toMatch(
      /^Giving in 2026: you've given \$3,100\.00 so far\. Ways to do more good for the same money, before December 31:\n• Give 2 years' worth this year, then skip a year: tax about \$[\d,]+ with it, \$[\d,]+ without \(saves about \$[\d,]+\)\./,
    );
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.fund_open",
      "tax.giving_no",
      "open",
    ]);
    const transactionsBefore = await client.transaction.count({ where: { userId } });
    const after = (
      await takeChatAction(userId, message.id, "tax.fund_open", { client, now: NOVEMBER })
    ).message;
    expect(after.refs.note).toBe(
      "Done: Demo Giving Fund is open (a stand-in for now). Putting $6,200 into it is on your deadlines; the money is yours to move.",
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "donor_fund_opened",
      { type: "user", id: userId },
      { partner: "demo", via: "chat" },
    );
    expect(
      await client.deadline.count({ where: { userId, title: "Put $6,200 into Demo Giving Fund" } }),
    ).toBe(1);
    expect(await client.transaction.count({ where: { userId } })).toBe(transactionsBefore);
    await expect(openDonorFund(userId, { client, now: NOVEMBER, via: "page" })).rejects.toThrow(
      "You already have Demo Giving Fund.",
    );
  });

  it("puts getting each missing receipt on the deadlines at Handle the safe stuff", async () => {
    const { userId } = await generousPerson("giving-auto");
    await setAutopilot(userId, "safe", { client, now: LINKED });
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).receiptsReminded).toBe(1);
    expect(
      await client.deadline.count({
        where: { userId, title: "Get the receipt for your gift to American Red Cross" },
      }),
    ).toBe(1);
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).receiptsReminded).toBe(0);
  });

  it("answers how should I give, gives Claude it, and offers no options for real accounts", async () => {
    const { userId } = await generousPerson("giving-chat");
    const { reply } = await sendToJane(userId, "should I use a donor-advised fund", {
      client,
      now: NOVEMBER,
    });
    expect(reply.body).toMatch(
      /^You've given \$3,100\.00 to charity in 2026 \(3 gifts\)\. 1 gift needs its charity's receipt\.\nWays to do more good for the same money:\n/,
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_giving", {}, { client, now: NOVEMBER })).content,
    );
    expect(tool.given).toBe("$3,100.00");
    expect(tool.demoAdvice[0]).toMatchObject({
      option: "Give 2 years' worth this year, then skip a year",
    });

    const real = await client.user.create({
      data: { email: `giving-real-${crypto.randomUUID()}@example.com` },
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
    expect((await loadGiving(real.id, { client, now: NOVEMBER })).options).toEqual([]);
    await expect(
      openDonorFund(real.id, { client, now: NOVEMBER, via: "page" }),
    ).rejects.toBeInstanceOf(GivingError);
  });
});
