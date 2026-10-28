import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({
  enqueueJob: vi.fn(async () => "job_1"),
  runJob: vi.fn(async () => "done"),
}));

import { scopedFor } from "@/lib/db-scoped";
import { brokerageAsks, setBrokerageBalance } from "./brokerage-balance";

// Money sent to an investing app, against a real, migrated Postgres: Jane asks what is in it,
// the answer becomes a counted investment account, and the ask goes away (read-only beta).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

describe.runIf(url)("asking what is in an investing app, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const make = async (who: string) =>
      (
        await client.user.create({
          data: { email: `brokerage-${who}-${crypto.randomUUID()}@example.com` },
        })
      ).id;
    userId = await make("me");
    otherId = await make("other");
    const checking = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 100_000,
      },
    });
    const row = (date: string, amountCents: number, description: string, pfc: string) =>
      client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "csv",
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description,
          pfcDetailed: pfc,
          pfcPrimary: "TRANSFER_OUT",
          categorySource: "rule",
          pending: false,
        },
      });
    const T = "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS";
    await row("2026-10-01", 50_000, "ROBINHOOD DEBITS", T);
    await row("2026-09-01", 50_000, "ROBINHOOD DEBITS", T);
    await row("2026-09-10", 20_000, "VANGUARD BUY INVESTMENT", T);
    await row("2026-03-01", 99_000, "SCHWAB", T);
    await row("2026-10-05", 4_000, "WHOLEFDS", "FOOD_AND_DRINK_GROCERIES");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await client.$disconnect();
  });

  it("asks about each app money went to in the last three months, and says how much went in", async () => {
    const asks = await brokerageAsks(scopedFor(userId, client), NOW);
    expect(asks.asks.map((a) => [a.app, a.inCents])).toEqual([
      ["Robinhood", 100_000],
      ["Vanguard", 20_000],
    ]);
    expect(asks.inLast3MonthsCents).toBe(120_000);
    // Another person sees nothing of it.
    expect((await brokerageAsks(scopedFor(otherId, client), NOW)).inLast3MonthsCents).toBe(0);
  });

  it("makes a counted investment account from the answer, once, and stops asking", async () => {
    const db = scopedFor(userId, client);
    expect(await setBrokerageBalance(db, "Robinhood", 1_234_56)).toEqual({ jobId: "job_1" });
    expect(await setBrokerageBalance(db, "Robinhood", 2_000_00)).toEqual({ jobId: "job_1" });
    const accounts = await client.account.findMany({ where: { userId, type: "investment" } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      name: "Robinhood",
      subtype: "brokerage",
      source: "csv",
      currentBalanceCents: 200_000,
    });
    const asks = await brokerageAsks(db, NOW);
    expect(asks.asks.map((a) => a.app)).toEqual(["Vanguard"]);
    // The total put in still counts what went to the answered app.
    expect(asks.inLast3MonthsCents).toBe(120_000);
  });

  it("refuses an app Jane doesn't know and a negative balance", async () => {
    const db = scopedFor(userId, client);
    expect(await setBrokerageBalance(db, "Acme Capital", 100)).toBeNull();
    expect(await setBrokerageBalance(db, "Vanguard", -5)).toBeNull();
  });
});
