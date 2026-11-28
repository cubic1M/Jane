import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { dailyNetWorth } from "@/insights/net-worth-series";
import { netWorthHistoryWithNote } from "@/lib/hub/net-worth-history";
import { rebuildPastBalances, workBackBalances } from "./past-balances";

// The hand-worked example (cents, Plaid's sign: money out is positive).
// Checking, first real balance on Nov 20: $1,000.00.
//   Nov 20: spent $20.00   -> the balance at the end of Nov 19 is 100000 + 2000  = 102000
//   Nov 19: paid in $500   -> the balance at the end of Nov 18 is 102000 - 50000 =  52000
//   Nov 18: spent $30.00   -> the balance at the end of Nov 17 is  52000 +  3000 =  55000
// Card, first real balance on Nov 20: $300.00 owed.
//   Nov 19: bought $40.00  -> owed at the end of Nov 18 is 30000 - 4000          =  26000
//   Nov 18: paid $100.00   -> owed at the end of Nov 17 is 26000 - (-10000)      =  36000
const checking = { id: "chk", type: "depository", anchorDay: "2026-11-20", anchorCents: 100000 };
const card = { id: "card", type: "credit", anchorDay: "2026-11-20", anchorCents: 30000 };
const moves = [
  { accountId: "chk", date: "2026-11-20", amountCents: 2000 },
  { accountId: "chk", date: "2026-11-19", amountCents: -50000 },
  { accountId: "chk", date: "2026-11-18", amountCents: 3000 },
  { accountId: "card", date: "2026-11-19", amountCents: 4000 },
  { accountId: "card", date: "2026-11-18", amountCents: -10000 },
];

describe("workBackBalances", () => {
  it("undoes each day's transactions, bank accounts one way and cards the other", () => {
    expect(workBackBalances([checking, card], moves)).toEqual([
      { accountId: "chk", date: "2026-11-17", balanceCents: 55000 },
      { accountId: "chk", date: "2026-11-18", balanceCents: 52000 },
      { accountId: "chk", date: "2026-11-19", balanceCents: 102000 },
      { accountId: "card", date: "2026-11-17", balanceCents: 36000 },
      { accountId: "card", date: "2026-11-18", balanceCents: 26000 },
      { accountId: "card", date: "2026-11-19", balanceCents: 30000 },
    ]);
  });

  it("leaves investments and loans alone, and an account whose transactions don't explain it", () => {
    const loan = { id: "loan", type: "loan", anchorDay: "2026-11-20", anchorCents: 500000 };
    expect(
      workBackBalances([loan], [{ accountId: "loan", date: "2026-11-19", amountCents: 1 }]),
    ).toEqual([]);
    // A card that would have owed less than nothing at a month end: no history.
    const overpaid = { id: "c2", type: "credit", anchorDay: "2026-12-05", anchorCents: 1000 };
    expect(
      workBackBalances([overpaid], [{ accountId: "c2", date: "2026-12-01", amountCents: 900_000 }]),
    ).toEqual([]);
  });

  it("never goes back further than the snapshots are kept", () => {
    const rows = workBackBalances(
      [checking],
      [{ accountId: "chk", date: "2020-01-01", amountCents: 100 }],
      10,
    );
    expect(rows[0].date).toBe("2026-11-10");
    expect(rows.at(-1)?.date).toBe("2026-11-19");
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("rebuildPastBalances against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  let accountId: string;
  const day = (d: string) => new Date(`${d}T00:00:00Z`);

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `past-${suffix}@example.com`, timezone: "America/Los_Angeles" },
      })
    ).id;
    accountId = (
      await client.account.create({
        data: {
          userId,
          source: "plaid",
          plaidAccountId: `past-${suffix}`,
          name: "Checking",
          type: "depository",
          currentBalanceCents: 100000,
        },
      })
    ).id;
    for (const m of moves.filter((x) => x.accountId === "chk")) {
      await client.transaction.create({
        data: {
          userId,
          accountId,
          source: "plaid",
          plaidTransactionId: `past-${suffix}-${m.date}`,
          date: day(m.date),
          amountCents: m.amountCents,
          description: "x",
        },
      });
    }
    // A pending charge is in no balance: never worked back.
    await client.transaction.create({
      data: {
        userId,
        accountId,
        source: "plaid",
        plaidTransactionId: `past-${suffix}-pending`,
        date: day("2026-11-19"),
        amountCents: 777,
        description: "pending",
        pending: true,
      },
    });
    await client.balanceSnapshot.create({
      data: { userId, accountId, date: day("2026-11-20"), balanceCents: 100000 },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const rows = () =>
    client.balanceSnapshot.findMany({
      where: { accountId },
      orderBy: { date: "asc" },
      select: { date: true, balanceCents: true, source: true },
    });

  it("writes the days before the first real balance, leaves the real ones, and is the same twice", async () => {
    const now = new Date("2026-11-28T12:00:00Z");
    expect(await rebuildPastBalances(userId, { client, now })).toBe(3);
    const first = await rows();
    expect(first.map((r) => [r.date.toISOString().slice(0, 10), r.balanceCents, r.source])).toEqual(
      [
        ["2026-11-17", 55000, "derived"],
        ["2026-11-18", 52000, "derived"],
        ["2026-11-19", 102000, "derived"],
        ["2026-11-20", 100000, null],
      ],
    );
    // Again, and after the real daily snapshot moves on: still one row a day, the real ones untouched.
    await rebuildPastBalances(userId, { client, now });
    await client.balanceSnapshot.create({
      data: { userId, accountId, date: day("2026-11-28"), balanceCents: 123456 },
    });
    await rebuildPastBalances(userId, { client, now });
    expect(await rows()).toHaveLength(5);
    expect((await rows()).filter((r) => r.source === null).map((r) => r.balanceCents)).toEqual([
      100000, 123456,
    ]);
  });

  it("makes net worth's line start at the first day, ending at today's figure to the cent", async () => {
    const snapshots = (await rows()).map((r) => ({
      accountId,
      date: r.date.toISOString().slice(0, 10),
      balanceCents: r.balanceCents,
    }));
    const line = dailyNetWorth({
      accounts: [{ id: accountId, type: "depository", currentBalanceCents: 123456 }],
      snapshots,
      owned: [],
      firstDay: snapshots[0].date,
      asOf: "2026-11-28",
      todayCents: 123456,
    });
    expect(line[0]).toEqual({ date: "2026-11-17", cents: 55000 });
    expect(line.at(-1)).toEqual({ date: "2026-11-28", cents: 123456 });
    expect(line.find((p) => p.date === "2026-11-20")?.cents).toBe(100000);
  });

  it("starts the chart at the first day of data and says what is carried flat before it", async () => {
    await client.account.create({
      data: {
        userId,
        source: "plaid",
        plaidAccountId: `past-inv-${suffix}`,
        name: "Brokerage",
        type: "investment",
        currentBalanceCents: 900000,
        createdAt: new Date("2026-11-27T10:00:00Z"),
      },
    });
    const { points, flatNote } = await netWorthHistoryWithNote(userId, 1023456, {
      client,
      now: new Date("2026-11-28T12:00:00Z"),
    });
    expect(points[0].date).toBe("2026-11-17");
    expect(points.at(-1)).toEqual({ date: "2026-11-28", cents: 1023456 });
    expect(flatNote).toBe("Before Nov 27, 2026, investments are shown at their first known value.");
  });

  it("uses the person's own day when no snapshot exists yet (evening in Los Angeles)", async () => {
    const other = (
      await client.user.create({
        data: { email: `past2-${suffix}@example.com`, timezone: "America/Los_Angeles" },
      })
    ).id;
    const acc = (
      await client.account.create({
        data: {
          userId: other,
          source: "plaid",
          plaidAccountId: `past2-${suffix}`,
          name: "Checking",
          type: "depository",
          currentBalanceCents: 50000,
        },
      })
    ).id;
    await client.transaction.create({
      data: {
        userId: other,
        accountId: acc,
        source: "plaid",
        plaidTransactionId: `past2-${suffix}`,
        date: day("2026-11-27"),
        amountCents: 1000,
        description: "x",
      },
    });
    // 7pm on Nov 27 in Los Angeles is Nov 28 in UTC: today is Nov 27, so the last worked-back day is Nov 26.
    await rebuildPastBalances(other, { client, now: new Date("2026-11-28T03:00:00Z") });
    const worked = await client.balanceSnapshot.findMany({
      where: { accountId: acc },
      orderBy: { date: "asc" },
    });
    expect(worked.map((r) => [r.date.toISOString().slice(0, 10), r.balanceCents])).toEqual([
      ["2026-11-26", 51000],
    ]);
    await client.user.deleteMany({ where: { id: other } });
  });
});
