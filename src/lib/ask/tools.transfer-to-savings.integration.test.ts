import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runAskTool } from "./tools";

// Walk batch 3's upload S6 (phone, 11-20): "how much do I put into savings each month?" got "I
// can't see any transfers into savings", beside $200.00 a month of "ONLINE TRANSFER TO ALLY BANK
// SAVINGS" that the search showed only as "Transfer". A transfer out to savings now says so; one to
// a person still names no one.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T18:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("a transfer to savings in the transaction search", () => {
  let client: PrismaClient;
  let id = "";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `transfer-savings-${crypto.randomUUID()}@example.com` },
    });
    id = user.id;
    const account = await client.account.create({
      data: { userId: id, source: "csv", name: "Checking", type: "checking" },
    });
    const tx = (
      date: string,
      amountCents: number,
      description: string,
      pfcPrimary: string,
      pfcDetailed: string | null = null,
    ) => ({
      userId: id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: `${date}-${description}`,
      date: day(date),
      amountCents,
      description,
      merchantName: null,
      pfcPrimary,
      pfcDetailed,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        // As the walked file has them, filed as a plain transfer out.
        tx("2026-09-20", 20_000, "ONLINE TRANSFER TO ALLY BANK SAVINGS", "TRANSFER_OUT"),
        tx("2026-10-20", 20_000, "ONLINE TRANSFER TO ALLY BANK SAVINGS", "TRANSFER_OUT"),
        // Filed as savings by the categorizer, whatever the line says.
        tx(
          "2026-11-03",
          5_000,
          "TRANSFER TO SAV XXXXX4410",
          "TRANSFER_OUT",
          "TRANSFER_OUT_SAVINGS",
        ),
        // A person, and money back from savings: neither is money into savings.
        tx("2026-11-01", 165_000, "ZELLE TO JORDAN SAVINGS CLUB", "TRANSFER_OUT"),
        tx("2026-11-05", -10_000, "ONLINE TRANSFER FROM ALLY BANK SAVINGS", "TRANSFER_IN"),
      ],
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id } });
    await client.$disconnect();
  });

  const search = async (input: Record<string, unknown>) =>
    JSON.parse(
      (
        await runAskTool(
          id,
          "search_transactions",
          { from: "2026-01-01", ...input },
          { client, now: NOW },
        )
      ).content,
    ) as { matched: number; transactions: { date: string; merchant: string; amount: string }[] };

  it("says Transfer to savings for money moved into savings, by the bank's filing or its words", async () => {
    const result = await search({ merchant: "savings" });
    const byDate = Object.fromEntries(result.transactions.map((t) => [t.date, t.merchant]));
    expect(byDate["2026-09-20"]).toBe("Transfer to savings");
    expect(byDate["2026-10-20"]).toBe("Transfer to savings");
    // Its words don't say savings, but the categorizer filed it so.
    expect((await search({ merchant: "sav xxxxx4410" })).transactions[0]?.merchant).toBe(
      "Transfer to savings",
    );
  });

  it("still names no one, and money coming back from savings isn't called money into it", async () => {
    const result = await search({ merchant: "savings" });
    const byDate = Object.fromEntries(result.transactions.map((t) => [t.date, t.merchant]));
    // A Zelle to a person whose name has "savings" in it isn't a transfer to savings.
    expect(byDate["2026-11-01"]).toBe("Transfer");
    expect(byDate["2026-11-05"]).toBe("Transfer");
    expect(JSON.stringify(result)).not.toMatch(/ally|jordan|zelle/i);
  });
});
