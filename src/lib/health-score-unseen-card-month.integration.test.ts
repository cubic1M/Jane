import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { CHECKING, input, monthsAgo, tx } from "@/detection/__fixtures__/build";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { healthFor, healthInput } from "./health-score";

// CodeRabbit sweep 1c (lib-02): a month with only a payment to a card Jane can't see is still a
// month in the average; a score that could not be kept is not reported as kept.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("health score: unseen cards and kept scores", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `health-unseen-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };
  const rent = (m: number) =>
    tx({
      date: monthsAgo(m, 1),
      amountCents: 125_000,
      description: "PARKSIDE APARTMENTS RENT",
      pfcPrimary: "RENT_AND_UTILITIES",
      pfcDetailed: "RENT_AND_UTILITIES_RENT",
    });
  const cardPayment = (m: number) =>
    tx({
      date: monthsAgo(m, 8),
      amountCents: 28_400,
      description: "CAPITAL ONE MOBILE PMT",
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("keeps a month with only a card payment in the average", async () => {
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 200_000 }],
      transactions: [rent(3), cardPayment(2), rent(1)],
    });
    const health = await healthInput(await person(), data, { client, now: NOW });
    expect(health.monthlySpendingCents).toBe(Math.round((125_000 + 28_400 + 125_000) / 3));
  });

  it("fails when the score could not be kept and no row was there to update", async () => {
    const userId = await person();
    // No such person's row can be created for a missing user: the insert fails, and it isn't a
    // conflict, so there is nothing to update.
    await client.user.delete({ where: { id: userId } });
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 200_000 }],
      transactions: [rent(3), rent(2), rent(1)],
    });
    await expect(
      healthFor(userId, { client, now: NOW, input: data, keep: true }),
    ).rejects.toThrow();
  });
});
