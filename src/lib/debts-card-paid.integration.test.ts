import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadDebts } from "./debts";

// Debugger 11-14: a checking statement paying a Chase card, with no card on file, read "No loans,
// cards or plans yet" on Loans & credit. The debt book says when a card is paid from checking that
// Jane can't see, and stops saying it once a card is on file.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-14T18:00:00Z");

describe.runIf(url)("the debt book with a card paid from checking", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `card-paid-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const checking = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "csv",
        dedupeKey: "card-paid-1",
        date: new Date("2026-10-08T00:00:00Z"),
        amountCents: 130_441,
        description: "CHASE CREDIT CRD EPAY DES:PMT",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("notes the card it can't see", async () => {
    const book = await loadDebts(userId, { client, now: NOW });
    expect(book.debts).toEqual([]);
    expect(book.cardPaidNotOnFile).toBe(true);
  });

  it("doesn't once a card is on file", async () => {
    await client.account.create({
      data: { userId, source: "csv", name: "Chase card", type: "credit", subtype: "credit card" },
    });
    const later = new Date(NOW.getTime() + 60_000);
    expect((await loadDebts(userId, { client, now: later })).cardPaidNotOnFile).toBe(false);
  });
});
