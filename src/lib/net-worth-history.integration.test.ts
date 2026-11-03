import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadNetWorthHistory, loansSeenWithoutBalance } from "./net-worth-history";

// Overnight upload QA: statements without a balance column left every balance unknown, and
// Home said "Net worth $0 · Your line starts today".
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

describe.runIf(url)("whether net worth is known", () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  const person = async (balances: (number | null)[]) => {
    const user = await client.user.create({
      data: { email: `worth-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    for (const [i, b] of balances.entries()) {
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: `Account ${i}`,
          type: i === 0 ? "depository" : "credit",
          subtype: i === 0 ? "checking" : "credit card",
          currentBalanceCents: b,
        },
      });
    }
    return user.id;
  };

  // Debugger 11-03: a landlord paying two mortgages read "You owe $0.00".
  it("finds loans in recent payments, unless a loan account says what's owed", async () => {
    const today = new Date("2026-11-03T12:00:00Z");
    const someone = await client.user.create({
      data: { email: `loans-seen-${crypto.randomUUID()}@example.com` },
    });
    users.push(someone.id);
    const account = await client.account.create({
      data: { userId: someone.id, source: "csv", name: "Checking", type: "depository" },
    });
    const pay = (merchantName: string, day: string, pfcDetailed: string, amountCents = 200_000) =>
      client.transaction.create({
        data: {
          userId: someone.id,
          accountId: account.id,
          date: new Date(`${day}T00:00:00Z`),
          amountCents,
          description: merchantName.toUpperCase(),
          merchantName,
          pfcPrimary: pfcDetailed.startsWith("LOAN") ? "LOAN_PAYMENTS" : "FOOD_AND_DRINK",
          pfcDetailed,
          source: "csv",
          dedupeKey: crypto.randomUUID(),
        },
      });
    await pay("Rocket Mortgage", "2026-10-01", "LOAN_PAYMENTS_MORTGAGE_PAYMENT");
    await pay("Rocket Mortgage", "2026-09-01", "LOAN_PAYMENTS_MORTGAGE_PAYMENT");
    await pay("Toyota Motor Cr", "2026-10-09", "LOAN_PAYMENTS_CAR_PAYMENT");
    // Paid off long ago, a card payment, and not a loan.
    await pay("Old Student Loan", "2026-02-01", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT");
    await pay("Chase Card", "2026-10-02", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    await pay("Grocer", "2026-10-03", "FOOD_AND_DRINK_GROCERIES");

    const seen = () => loansSeenWithoutBalance(someone.id, { client, now: today });
    expect(await seen()).toEqual(["Rocket Mortgage", "Toyota Motor Cr"]);

    await client.account.create({
      data: {
        userId: someone.id,
        source: "plaid",
        name: "Mortgage",
        type: "loan",
        currentBalanceCents: 30_000_000,
      },
    });
    expect(await seen()).toEqual([]);
  });

  it("isn't known when no account has a balance", async () => {
    const history = await loadNetWorthHistory(await person([null, null]), { client, now: NOW });
    expect(history?.known).toBe(false);
  });

  it("is known once one account has a balance", async () => {
    const history = await loadNetWorthHistory(await person([250_000, null]), {
      client,
      now: NOW,
    });
    expect(history?.known).toBe(true);
    expect(history?.todayCents).toBe(250_000);
  });
});
