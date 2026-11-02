import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadMonthClose } from "./close";
import { savingsLedger } from "./ledger";
import { recordFindingDone, recordShown } from "./outcomes";

// Debugger 11-02: a person with 4 findings waiting on /jane read "Found 0 · Open 0" and "Nothing
// new this month" on their close: findings nobody had acted on never reached it. And a finding
// made in a US evening is already tomorrow in UTC, so "up to today" left it out.
const url = process.env.TEST_DATABASE_URL;
// 11:35pm on Nov 1 in Los Angeles.
const NOW = new Date("2026-11-02T06:35:00Z");

describe.runIf(url)("a close and the findings waiting for an answer", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  async function person() {
    const user = await client.user.create({
      data: {
        email: `close-open-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    made.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const tx = await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        dedupeKey: "t1",
        date: new Date("2026-10-05T00:00:00Z"),
        amountCents: 2_299,
        description: "NETFLIX.COM",
        merchantName: "Netflix",
      },
    });
    const finding = (
      type: "subscription_review" | "bank_fees" | "price_increase" | "insurance_reshop",
      key: string,
      status: "new" | "shown" | "declined" | "approved",
      amountCents: number,
      createdAt = NOW,
      annualSavingsCents: number | null = amountCents,
    ) =>
      client.finding.create({
        data: {
          userId: user.id,
          type,
          key,
          status,
          title: `Finding ${key}`,
          explanation: "Why it matters.",
          amountCents,
          annualSavingsCents,
          confidence: "medium",
          evidence: { transactionIds: [tx.id] },
          createdAt,
        },
      });
    return { userId: user.id, finding };
  }

  it("counts a waiting finding as found in its own month, by the person's day, and open", async () => {
    const { userId, finding } = await person();
    await finding("subscription_review", "merchant:netflix", "new", 27_588);
    await finding("bank_fees", "fees", "shown", 3_500);
    const october = await loadMonthClose(userId, "2026-10", { client, now: NOW });
    const november = await loadMonthClose(userId, "2026-11", { client, now: NOW });

    // Nov 1 for this person, though the clock in UTC says Nov 2.
    expect(october.found).toEqual([]);
    expect(october.open.map((e) => e.title)).toEqual(["Finding merchant:netflix", "Finding fees"]);
    expect(november.found.map((e) => e.title)).toEqual([
      "Finding merchant:netflix",
      "Finding fees",
    ]);
    expect(november.quiet).toBe(false);
    expect(november.allGood).toBe(false);
    expect(november.found[0]).toMatchObject({
      state: "estimated",
      cents: 27_588,
      yearly: true,
      foundOn: "2026-11-01",
    });
    expect(november.found[0].confidencePercent).toBeGreaterThan(0);
    expect(november.found[0].href).toMatch(/^\/report\//);
  });

  // Seen in the app: "State Farm could cost less, about $1,698.00/yr" was the premium, the top chip.
  it("shows what could be saved, not what the bill is, and no chip with no dollar figure", async () => {
    const { userId, finding } = await person();
    await finding("insurance_reshop", "merchant:state farm", "new", 169_800, NOW, null);
    await finding("subscription_review", "merchant:netflix", "new", 2_299, NOW, 27_588);
    const november = await loadMonthClose(userId, "2026-11", { client, now: NOW });
    const byTitle = new Map(november.open.map((e) => [e.title, e]));
    expect(byTitle.get("Finding merchant:netflix")?.cents).toBe(27_588);
    expect(byTitle.get("Finding merchant:state farm")?.cents).toBe(0);
    expect(november.chips.map((c) => c.figure)).toEqual(["$276/yr"]);
    expect(november.foundCents).toBe(27_588);
  });

  // Seen in the app: Netflix "Stays an estimate: your transactions can't show this one".
  // Seen in the app: "Stop paying overdraft and bank fees, about $257/yr" and the two fee findings
  // it adds up ($216 and $41), one under the other, where /saved shows the $257 once.
  it("lists money once when a suggestion on the record is the same money as a finding", async () => {
    const { userId, finding } = await person();
    await finding("bank_fees", "fees:checking", "new", 21_600);
    await finding("bank_fees", "fees:card", "new", 4_100);
    await finding("subscription_review", "merchant:netflix", "new", 27_588);
    const key = "cost:bank_fees";
    const base = {
      capability: "cost",
      topic: "bank_fees",
      title: "Stop paying bank fees",
      worthKind: "saves" as const,
      watch: { kind: "fee_stops" as const, pfcs: ["BANK_FEES_ATM_FEES"], monthlyCents: 2_142 },
    };
    await client.suggestion.create({
      data: {
        userId,
        key,
        ...base,
        worthCents: 25_700,
        confidencePercent: 79,
        confidenceReason: "8 bank fees in 6 months of data",
        urgency: "soon",
        why: "x",
        actionLabel: "See the fees",
        actionHref: "/insights",
      },
    });
    await recordShown(userId, [{ key, ...base, worthCents: 25_700, confidencePercent: 79 }], {
      client,
      now: NOW,
    });

    const close = await loadMonthClose(userId, "2026-11", { client, now: NOW });
    expect(close.open.map((e) => e.title).sort()).toEqual([
      "Finding merchant:netflix",
      "Stop paying bank fees",
    ]);
    expect(close.open.reduce((sum, e) => sum + e.cents, 0)).toBe(25_700 + 27_588);
  });

  // Seen in the app: "Done, checking $216/yr" and "Stop paying bank and card fees, still to do
  // $216/yr", the same fees, on /close and /saved. The person had said Done on the finding.
  it("takes the suggestion off once they've said Done on a finding that's the same money", async () => {
    const { userId, finding } = await person();
    const done = await finding("bank_fees", "fees:checking", "approved", 21_600);
    await finding("bank_fees", "fees:card", "new", 4_100);
    const key = "cost:bank_fees";
    const base = {
      capability: "cost",
      topic: "bank_fees",
      title: "Stop paying bank fees",
      worthKind: "saves" as const,
      watch: { kind: "fee_stops" as const, pfcs: ["BANK_FEES_ATM_FEES"], monthlyCents: 2_142 },
    };
    await client.suggestion.create({
      data: {
        userId,
        key,
        ...base,
        worthCents: 25_700,
        confidencePercent: 79,
        confidenceReason: "8 bank fees in 6 months of data",
        urgency: "soon",
        why: "x",
        actionLabel: "See the fees",
        actionHref: "/insights",
      },
    });
    await recordShown(userId, [{ key, ...base, worthCents: 25_700, confidencePercent: 79 }], {
      client,
      now: NOW,
    });
    await recordFindingDone(userId, done.id, { client, now: NOW });

    const ledger = await savingsLedger(userId, { client, now: NOW });
    expect(ledger.entries.map((e) => e.title)).toEqual(["Finding fees:checking"]);
    expect(ledger.estimatedCents).toBe(0);
    // The fee finding nobody has answered is still theirs to decide. The one they said Done on is
    // what they did: nothing can settle it, so it isn't open (src/planning/close.ts).
    const close = await loadMonthClose(userId, "2026-11", { client, now: NOW });
    expect(close.open.map((e) => e.title)).toEqual(["Finding fees:card"]);
    expect(close.did.map((e) => e.title)).toEqual(["Finding fees:checking"]);
  });

  it("keeps a suggestion for one company when they said Done on a finding of the same kind", async () => {
    const { userId, finding } = await person();
    const done = await finding("subscription_review", "merchant:netflix", "approved", 27_588);
    const key = "subscriptions:subscription_review:hulu";
    const base = {
      capability: "subscriptions",
      topic: "subscription_review",
      title: "Cancel Hulu",
      worthKind: "saves" as const,
      watch: { kind: "charge_stops" as const, payees: [], monthlyCents: 1_799 },
    };
    await client.suggestion.create({
      data: {
        userId,
        key,
        ...base,
        worthCents: 21_588,
        confidencePercent: 80,
        confidenceReason: "monthly",
        urgency: "soon",
        why: "x",
        actionLabel: "Review",
        actionHref: "/subscriptions",
      },
    });
    await recordShown(userId, [{ key, ...base, worthCents: 21_588, confidencePercent: 80 }], {
      client,
      now: NOW,
    });
    await recordFindingDone(userId, done.id, { client, now: NOW });

    const ledger = await savingsLedger(userId, { client, now: NOW });
    expect(ledger.entries.map((e) => e.title).sort()).toEqual([
      "Cancel Hulu",
      "Finding merchant:netflix",
    ]);
  });

  it("still lists the findings when the person said no to the suggestion", async () => {
    const { userId, finding } = await person();
    await finding("bank_fees", "fees:checking", "new", 21_600);
    const key = "cost:bank_fees";
    await client.suggestion.create({
      data: {
        userId,
        key,
        capability: "cost",
        topic: "bank_fees",
        title: "Stop paying bank fees",
        status: "no",
        worthCents: 21_600,
        worthKind: "saves",
        confidencePercent: 79,
        confidenceReason: "8 bank fees in 6 months of data",
        urgency: "soon",
        why: "x",
        actionLabel: "See the fees",
        actionHref: "/insights",
      },
    });
    const close = await loadMonthClose(userId, "2026-11", { client, now: NOW });
    expect(close.open.map((e) => e.title)).toEqual(["Finding fees:checking"]);
  });

  it("says a waiting finding is an estimate until they act, not that it can't be shown", async () => {
    const { userId, finding } = await person();
    await finding("subscription_review", "merchant:netflix", "new", 27_588);
    const [entry] = (await loadMonthClose(userId, "2026-11", { client, now: NOW })).open;
    expect(entry.rule).toBe("An estimate until you act on it.");
  });

  it("dates a finding from a US evening on the last day of a month in that month", async () => {
    const { userId, finding } = await person();
    // 5pm on Oct 31 in Los Angeles: Nov 1 in UTC.
    await finding("bank_fees", "fees", "new", 3_500, new Date("2026-11-01T00:00:00Z"));
    const october = await loadMonthClose(userId, "2026-10", { client, now: NOW });
    const november = await loadMonthClose(userId, "2026-11", { client, now: NOW });
    expect(october.found.map((e) => e.title)).toEqual(["Finding fees"]);
    expect(november.found).toEqual([]);
  });

  it("leaves out what the person said no to or already said yes to", async () => {
    const { userId, finding } = await person();
    await finding("bank_fees", "fees", "declined", 3_500);
    await finding("subscription_review", "merchant:netflix", "approved", 27_588);
    const november = await loadMonthClose(userId, "2026-11", { client, now: NOW });
    expect(november.open.map((e) => e.title)).not.toContain("Finding fees");
    expect(november.open.map((e) => e.title)).not.toContain("Finding merchant:netflix");
  });

  it("shows a price rise made in a US evening once, under Changed", async () => {
    const { userId, finding } = await person();
    await finding("price_increase", "merchant:netflix", "new", 400);
    const november = await loadMonthClose(userId, "2026-11", { client, now: NOW });
    expect(november.changed.map((c) => c.title)).toEqual(["Finding merchant:netflix"]);
    expect(november.found).toEqual([]);
    expect(november.open).toEqual([]);
  });
});
