import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runAskTool } from "./tools";

// Desktop sweep 5's upload S1 (walk batch 2, 11-18): "how much does my mom send me?" searched for
// "mom" and Claude said nothing was found, beside three "Deposit from MOM VENMO CASHOUT" lines,
// because a transfer's own words were never matched. They are matched now, and still never shown:
// the rows come back as "Transfer".
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T18:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("searching a transfer by the name on it", () => {
  let client: PrismaClient;
  let id = "";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `transfer-words-${crypto.randomUUID()}@example.com` },
    });
    id = user.id;
    const account = await client.account.create({
      data: { userId: id, source: "csv", name: "Checking", type: "checking" },
    });
    const tx = (date: string, amountCents: number, description: string, pfcPrimary: string) => ({
      userId: id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: `${date}-${description}`,
      date: day(date),
      amountCents,
      description,
      merchantName: null,
      pfcPrimary,
      pfcDetailed: null,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        tx("2026-08-20", -20_000, "Deposit from MOM VENMO CASHOUT", "TRANSFER_IN"),
        tx("2026-09-20", -20_000, "Deposit from MOM VENMO CASHOUT", "TRANSFER_IN"),
        tx("2026-10-20", -20_000, "Deposit from MOM VENMO CASHOUT", "TRANSFER_IN"),
        tx("2026-11-01", 72_500, "SUNSET VILLAS RENT", "RENT_AND_UTILITIES"),
      ],
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id } });
    await client.$disconnect();
  });

  it("finds the transfers by the word the person uses, and names no one", async () => {
    const { content } = await runAskTool(
      id,
      "search_transactions",
      { merchant: "mom", from: "2026-01-01" },
      { client, now: NOW },
    );
    const result = JSON.parse(content);
    expect(result.matched).toBe(3);
    expect(result.totalMoneyIn).toBe("$600.00");
    expect(result.transactions.map((t: { merchant: string }) => t.merchant)).toEqual([
      "Transfer",
      "Transfer",
      "Transfer",
    ]);
    expect(content).not.toMatch(/mom|venmo/i);
  });
});
