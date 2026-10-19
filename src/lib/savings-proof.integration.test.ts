import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type ActionType, type FindingType } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { savedSource } from "@/lib/jane-agent/sources/saved";
import { provenSavings, revokeSavedShares, shareSavedTotal, sharedTotal } from "./savings-proof";

// Spec step 139 against a real, migrated Postgres: only savings the person's transactions
// show count as confirmed, each with its receipt; everything else stays an estimate; the
// total can be shared (and taken down); Jane says so in the chat at a milestone.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T15:00:00Z");

describe.runIf(url)("what Jane saved you, against a real database", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    return { userId: user.id, accountId: account.id };
  }

  async function charge(
    who: { userId: string; accountId: string },
    date: string,
    description: string,
    amountCents: number,
    merchantName: string | null = null,
  ) {
    await client.transaction.create({
      data: {
        userId: who.userId,
        accountId: who.accountId,
        source: "csv",
        date: new Date(`${date}T00:00:00Z`),
        description,
        merchantName,
        amountCents,
        pfcPrimary: "GENERAL_SERVICES",
      },
    });
  }

  async function action(
    userId: string,
    {
      title,
      type,
      findingType,
      estimate,
      evidence = {},
      data = {},
    }: {
      title: string;
      type: ActionType;
      findingType: FindingType;
      estimate: number;
      evidence?: object;
      data?: object;
    },
  ) {
    const finding = await client.finding.create({
      data: {
        userId,
        type: findingType,
        key: `k-${crypto.randomUUID()}`,
        title,
        annualSavingsCents: estimate,
        confidence: "high",
        evidence,
        status: "approved",
      },
    });
    const decision = await client.decision.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: { title, annualSavingsCents: estimate },
      },
    });
    return client.action.create({
      data: { userId, decisionId: decision.id, type, status: "done", ...data },
    });
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function seeded(prefix: string) {
    const who = await person(prefix);
    const { userId } = who;
    // A refund that came back.
    await charge(who, "2026-09-20", "TARGET REFUND", -6_420, "Target");
    await action(userId, {
      title: "Charged twice at Target",
      type: "request_refund",
      findingType: "duplicate_charge",
      estimate: 6_420,
      data: {
        completedAt: new Date("2026-09-20T12:00:00Z"),
        refundSeenAt: new Date("2026-09-20T00:00:00Z"),
        refundCents: 6_420,
      },
    });
    // Hulu cancelled on Jul 15 after the Jul 10 charge, and nothing since.
    for (const date of ["2026-05-10", "2026-06-10", "2026-07-10"]) {
      await charge(who, date, "HULU 877-8244858", 1_799, "Hulu");
    }
    await action(userId, {
      title: "Cancel Hulu",
      type: "cancel_subscription",
      findingType: "subscription_review",
      estimate: 21_588,
      evidence: {
        merchant: "Hulu",
        frequency: "MONTHLY",
        lastAmountCents: 1_799,
        annualCostCents: 21_588,
      },
      data: {
        completedAt: new Date("2026-07-15T12:00:00Z"),
        cancelledOn: new Date("2026-07-15T00:00:00Z"),
      },
    });
    // Comcast lowered on a call on Aug 1, and the next bill was lower.
    await charge(who, "2026-07-03", "COMCAST", 9_000, "Comcast");
    await charge(who, "2026-08-03", "COMCAST", 8_000, "Comcast");
    await action(userId, {
      title: "Lower your Comcast bill",
      type: "negotiate_bill",
      findingType: "bill_negotiation",
      estimate: 15_000,
      evidence: { merchant: "Comcast", frequency: "MONTHLY", lastAmountCents: 9_000 },
      data: { completedAt: new Date("2026-08-01T12:00:00Z"), confirmedAnnualCents: 12_000 },
    });
    // Verizon confirmed a lower price on a call, but no lower bill yet: an estimate.
    await charge(who, "2026-10-01", "VERIZON WIRELESS", 14_500, "Verizon");
    await action(userId, {
      title: "Lower your Verizon bill",
      type: "negotiate_bill",
      findingType: "bill_negotiation",
      estimate: 30_000,
      evidence: { merchant: "Verizon", frequency: "MONTHLY", lastAmountCents: 14_500 },
      data: { completedAt: new Date("2026-10-10T12:00:00Z"), confirmedAnnualCents: 24_000 },
    });
    // Still in progress: an estimate.
    await action(userId, {
      title: "Get your bank fees back",
      type: "recover_bank_fees",
      findingType: "bank_fees",
      estimate: 7_400,
      data: { status: "in_progress" },
    });
    return who;
  }

  it("counts only what the transactions show, each with its receipt", async () => {
    const { userId } = await seeded("saved-proof");
    const saved = await provenSavings(userId, { client, now: NOW });
    expect(saved.confirmed.map((r) => [r.title, r.kind, r.cents, r.seen.date])).toEqual([
      ["Cancel Hulu", "cancelled", 21_588, "2026-07-10"],
      ["Lower your Comcast bill", "lower_bill", 12_000, "2026-08-03"],
      ["Charged twice at Target", "refund", 6_420, "2026-09-20"],
    ]);
    expect(saved.confirmedCents).toBe(21_588 + 12_000 + 6_420);
    expect(saved.confirmed[1].proof).toBe(
      "The bill came in at $80.00 on Aug 3, 2026, down from $90.00.",
    );
    expect(saved.estimated.map((e) => [e.title, e.cents, e.why])).toEqual([
      [
        "Lower your Verizon bill",
        24_000,
        "The company confirmed it. It counts once the lower bill shows up in your transactions.",
      ],
      ["Get your bank fees back", 7_400, "Jane is still working on it."],
    ]);
  });

  it("doesn't count a cancellation before its next charge was due, or one charged again", async () => {
    const who = await person("saved-cancel");
    await charge(who, "2026-10-01", "SPOTIFY", 1_199, "Spotify");
    await charge(who, "2026-10-10", "PELOTON", 4_400, "Peloton");
    await charge(who, "2026-10-12", "PELOTON", 4_400, "Peloton");
    for (const [merchant, cancelledOn] of [
      ["Spotify", "2026-10-05"],
      ["Peloton", "2026-10-11"],
    ]) {
      await action(who.userId, {
        title: `Cancel ${merchant}`,
        type: "cancel_subscription",
        findingType: "subscription_review",
        estimate: 10_000,
        evidence: { merchant, frequency: "MONTHLY", lastAmountCents: 1_000 },
        data: {
          completedAt: new Date(`${cancelledOn}T12:00:00Z`),
          cancelledOn: new Date(`${cancelledOn}T00:00:00Z`),
        },
      });
    }
    const saved = await provenSavings(who.userId, { client, now: NOW });
    expect(saved.confirmed).toEqual([]);
    expect(saved.confirmedCents).toBe(0);
    expect(saved.estimated).toHaveLength(2);
  });

  it("shares only the total, and Stop sharing takes it down", async () => {
    const { userId } = await seeded("saved-share");
    const { token, totalCents } = await shareSavedTotal(userId, { client, now: NOW });
    expect(totalCents).toBe(40_008);
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await sharedTotal(token, { client })).toMatchObject({ totalCents: 40_008 });
    // Only the hash is kept.
    expect(await client.savedShare.count({ where: { tokenHash: token } })).toBe(0);
    expect(await sharedTotal("not-a-real-token-at-all", { client })).toBeNull();
    expect(await revokeSavedShares(userId, { client, now: NOW })).toBe(1);
    expect(await sharedTotal(token, { client })).toBeNull();
  });

  it("says so in the chat at a milestone, shares from there, and answers 'how much have you saved me?'", async () => {
    const { userId } = await seeded("saved-chat");
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    expect(snapshot?.saved).toEqual({ confirmedCents: 40_008 });
    await postMessages(
      userId,
      gather(snapshot!, NOW, { trigger: "open", sources: [savedSource] }),
      {
        client,
        now: NOW,
      },
    );
    const message = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: "saved:milestone:25000" },
    });
    expect(message.body).toMatch(
      /^I've now saved you \$400\.08, and every dollar of it shows in your own transactions/,
    );
    const { message: answered } = await takeChatAction(userId, message.id, "saved.share", {
      client,
      now: NOW,
    });
    expect(answered.refs.note).toMatch(/^Here's your link to \$400\.08: only the total is on it\./);
    const link = answered.actions.find((a) => a.label === "Open your link");
    expect(link && "href" in link ? link.href : "").toMatch(/^\/s\/[A-Za-z0-9_-]{24}$/);

    const reply = await answerByRules(userId, { kind: "saved" }, { client, now: NOW });
    expect(reply?.body).toBe(
      "I've saved you $400.08 so far, confirmed in your own transactions (3 receipts). About $314.00 a year more is still an estimate until your transactions show it.",
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "proven_savings", {}, { client, now: NOW })).content,
    );
    expect(tool.confirmedTotal).toBe("$400.08");
    expect(tool.receipts).toHaveLength(3);
  });

  it("only ever counts the person's own", async () => {
    const mine = await seeded("saved-mine");
    const other = await person("saved-other");
    expect((await provenSavings(other.userId, { client, now: NOW })).confirmed).toEqual([]);
    expect((await provenSavings(mine.userId, { client, now: NOW })).confirmed).toHaveLength(3);
  });
});
