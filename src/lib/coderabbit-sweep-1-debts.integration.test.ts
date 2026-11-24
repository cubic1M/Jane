import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadDebts } from "./debts";

// CodeRabbit sweep 1, src/lib helpers: a pending card payment isn't a card Jane can't see yet.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-15T20:00:00Z");

describe.runIf(url)("the debt book reads posted payments", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  async function personWithCardPayment(pending: boolean) {
    const user = await client.user.create({
      data: { email: `debts-pending-${crypto.randomUUID()}@example.com` },
    });
    ids.push(user.id);
    const checking = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "csv" as const,
        date: new Date("2026-11-10T00:00:00Z"),
        amountCents: 50_000,
        description: "CHASE CARD PAYMENT",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        pending,
      },
    });
    return user.id;
  }

  it("counts a posted card payment as a card not on file", async () => {
    const book = await loadDebts(await personWithCardPayment(false), { client, now: NOW });
    expect(book.cardPaidNotOnFile).toBe(true);
  });
  it("does not count a pending one", async () => {
    const book = await loadDebts(await personWithCardPayment(true), { client, now: NOW });
    expect(book.cardPaidNotOnFile).toBe(false);
  });
});
