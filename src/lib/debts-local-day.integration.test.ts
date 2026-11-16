import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadDebts, saveDebtTerms } from "./debts";

// Gate C's calendar sweep (src/sweep/), 11-15: the debts read UTC's day. At 7pm in Los Angeles the
// Loans tree's "in the next month" lost a payment due that day, and a payoff date of today was
// refused as in the past. The book is on the person's own day, the same at 7pm as at 3pm.

const url = process.env.TEST_DATABASE_URL;
// 3pm and 7pm on Nov 15 in Los Angeles; 7pm is already Nov 16 in UTC.
const AFTERNOON = new Date("2026-11-15T23:00:00Z");
const EVENING = new Date("2026-11-16T03:00:00Z");

describe.runIf(url)("debts on the person's own day", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `debts-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const loan = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Car loan",
        type: "loan",
        subtype: "auto",
        currentBalanceCents: 1_200_000,
      },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: loan.id,
        kind: "loan",
        minimumPaymentCents: 35_000,
        nextPaymentDueDate: new Date("2026-11-15T00:00:00Z"),
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is the same book at 7pm as at 3pm, on their day", async () => {
    const afternoon = await loadDebts(userId, { client, now: AFTERNOON });
    expect(afternoon.debts).toHaveLength(1);
    const evening = await loadDebts(userId, { client, now: EVENING });
    expect(evening).toEqual(afternoon);
  });

  it("takes a payoff date of today at 7pm", async () => {
    const [debt] = (await loadDebts(userId, { client, now: EVENING })).debts;
    await saveDebtTerms(
      userId,
      { debtKey: debt!.key, apr: "6.5", minimum: "", balance: "", payoffDate: "2026-11-15" },
      { client, now: EVENING },
    );
    expect(await client.debtTerms.count({ where: { userId } })).toBe(1);
  });
});
