import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type ActionType, type FindingType } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { provenSavings, verifiedSavings } from "./savings-proof";

// CodeRabbit sweep 1c (lib-02): receipts are bound to their own transaction (refunds by merchant,
// suggestions by id), a refund seen once stays confirmed after its day leaves the transactions
// kept, and a cancellation is judged against the charge due after it, not before.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T15:00:00Z");

describe.runIf(url)("savings receipts", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `receipts-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const mk = (name: string) =>
      client.account.create({
        data: { userId: user.id, source: "csv", name, type: "depository" },
      });
    return { userId: user.id, a: (await mk("Checking")).id, b: (await mk("Savings")).id };
  }
  async function charge(
    who: { userId: string },
    accountId: string,
    date: string,
    description: string,
    amountCents: number,
    merchantName: string | null = null,
  ) {
    return client.transaction.create({
      data: {
        userId: who.userId,
        accountId,
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
    o: {
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
        type: o.findingType,
        key: `k-${crypto.randomUUID()}`,
        title: o.title,
        annualSavingsCents: o.estimate,
        confidence: "high",
        evidence: o.evidence ?? {},
        status: "approved",
      },
    });
    const decision = await client.decision.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: { title: o.title, annualSavingsCents: o.estimate },
      },
    });
    return client.action.create({
      data: { userId, decisionId: decision.id, type: o.type, status: "done", ...o.data },
    });
  }
  const refundAction = (userId: string, merchant: string, day: string, cents: number) =>
    action(userId, {
      title: `Charged twice at ${merchant}`,
      type: "request_refund",
      findingType: "duplicate_charge",
      estimate: cents,
      evidence: { merchant },
      data: {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        completedAt: new Date(`${day}T12:00:00Z`),
        refundSeenAt: new Date(`${day}T00:00:00Z`),
        refundCents: cents,
      },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("keeps a suggestion confirmed by another transaction with the same date, text and amount", async () => {
    const who = await person();
    const first = await charge(who, who.a, "2026-09-20", "TARGET REFUND", -6_420, "Target");
    const second = await charge(who, who.b, "2026-09-20", "TARGET REFUND", -6_420, "Target");
    await refundAction(who.userId, "Target", "2026-09-20", 6_420);
    const receipt = (await provenSavings(who.userId, { client, now: NOW })).confirmed[0];
    const other = receipt.seen.id === first.id ? second : first;
    await client.suggestionOutcome.create({
      data: {
        userId: who.userId,
        suggestionKey: "refund:other",
        capability: "refund",
        topic: "refund",
        title: "A refund on the other account",
        firstShownAt: NOW,
        lastShownAt: NOW,
        expectedCents: 6_420,
        worthKind: "once",
        confidencePercent: 90,
        status: "confirmed",
        confirmedCents: 6_420,
        yearly: false,
        evidenceTxIds: [other.id],
      },
    });
    const all = await verifiedSavings(who.userId, { client, now: NOW });
    expect(all.suggestions.confirmed).toHaveLength(1);
    expect(all.confirmedCents).toBe(12_840);
  });

  it("drops a suggestion confirmed by the same transaction as a receipt", async () => {
    const who = await person();
    const only = await charge(who, who.a, "2026-09-20", "TARGET REFUND", -6_420, "Target");
    await refundAction(who.userId, "Target", "2026-09-20", 6_420);
    await client.suggestionOutcome.create({
      data: {
        userId: who.userId,
        suggestionKey: "refund:same",
        capability: "refund",
        topic: "refund",
        title: "The same refund",
        firstShownAt: NOW,
        lastShownAt: NOW,
        expectedCents: 6_420,
        worthKind: "once",
        confidencePercent: 90,
        status: "confirmed",
        confirmedCents: 6_420,
        yearly: false,
        evidenceTxIds: [only.id],
      },
    });
    const all = await verifiedSavings(who.userId, { client, now: NOW });
    expect(all.suggestions.confirmed).toHaveLength(0);
    expect(all.confirmedCents).toBe(6_420);
  });

  it("does not confirm a refund with another merchant's credit of the same day and amount", async () => {
    const who = await person();
    await charge(who, who.a, "2026-09-20", "WALMART REFUND", -2_000, "Walmart");
    await refundAction(who.userId, "Target", "2026-09-20", 2_000);
    const proven = await provenSavings(who.userId, { client, now: NOW });
    expect(proven.confirmed).toHaveLength(0);
    expect(proven.estimated).toHaveLength(1);
  });

  it("keeps a refund confirmed after its day is older than the transactions kept", async () => {
    const who = await person();
    await charge(who, who.a, "2026-08-02", "COFFEE", 450);
    await refundAction(who.userId, "Target", "2026-01-10", 5_000);
    const proven = await provenSavings(who.userId, { client, now: NOW });
    expect(proven.confirmed).toHaveLength(1);
    expect(proven.confirmed[0]).toMatchObject({ kind: "refund", cents: 5_000 });
    expect(proven.confirmedCents).toBe(5_000);
  });

  describe("a cancelled charge", () => {
    const cancel = (userId: string) =>
      action(userId, {
        title: "Cancel Hulu",
        type: "cancel_subscription",
        findingType: "subscription_review",
        estimate: 21_588,
        evidence: { merchant: "Hulu", frequency: "MONTHLY", annualCostCents: 21_588 },
        data: {
          completedAt: new Date("2026-04-10T12:00:00Z"),
          cancelledOn: new Date("2026-04-10T00:00:00Z"),
        },
      });

    it("is not confirmed by statements that end before the charge due after the cancellation", async () => {
      const who = await person();
      await charge(who, who.a, "2026-01-01", "HULU 877-8244858", 1_799, "Hulu");
      await charge(who, who.a, "2026-04-30", "COFFEE", 450);
      await cancel(who.userId);
      const proven = await provenSavings(who.userId, { client, now: NOW });
      expect(proven.confirmed.filter((r) => r.kind === "cancelled")).toHaveLength(0);
    });

    it("is confirmed once statements run past that due day with nothing since", async () => {
      const who = await person();
      await charge(who, who.a, "2026-01-01", "HULU 877-8244858", 1_799, "Hulu");
      await charge(who, who.a, "2026-06-15", "COFFEE", 450);
      await cancel(who.userId);
      const proven = await provenSavings(who.userId, { client, now: NOW });
      expect(proven.confirmed.filter((r) => r.kind === "cancelled")).toHaveLength(1);
    });
  });
});
