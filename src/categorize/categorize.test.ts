import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm", () => ({ classifyMerchants: vi.fn() }));

import { categorizeLeftovers, categorizeTransactions } from "./categorize";
import { classifyMerchants } from "./llm";
import type { NormalizedTransaction } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";

function txn(
  description: string,
  extra: Partial<NormalizedTransaction> = {},
): NormalizedTransaction {
  return {
    accountRef: "acct_1",
    date: "2026-10-01",
    amountCents: 1000,
    description,
    merchantName: null,
    categoryPrimary: null,
    categoryDetailed: null,
    pending: false,
    externalId: description,
    hints: {},
    ...extra,
  };
}

// Rows in the merchant cache; the mock honours the query's source filter.
let cache: { merchantKey: string; pfcDetailed: string; source: string }[] = [];
const findMany = vi.fn(async ({ where }: { where: { source?: string } }) =>
  cache.filter((row) => !where.source || row.source === where.source),
);
const createMany = vi.fn();
const db = { userId: "user_1", merchantCategories: { findMany, createMany } } as unknown as Pick<
  ScopedDb,
  "userId" | "merchantCategories"
>;

describe("categorizeTransactions", () => {
  beforeEach(() => {
    cache = [];
    findMany.mockClear();
    createMany.mockReset().mockResolvedValue({ count: 0 });
    vi.mocked(classifyMerchants).mockReset().mockResolvedValue(new Map());
  });

  it("uses rules first and never asks the LLM about rule matches", async () => {
    const [result] = await categorizeTransactions([txn("NETFLIX.COM")], db);

    expect(result.category?.detailed).toBe("ENTERTAINMENT_TV_AND_MOVIES");
    expect(result.categorySource).toBe("rule");
    // Only the person's own merchant rules are looked up.
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.source).toBe("user");
    expect(classifyMerchants).not.toHaveBeenCalled();
  });

  it("puts the person's own merchant rule ahead of everything", async () => {
    cache = [
      { merchantKey: "netflix", pfcDetailed: "ENTERTAINMENT_OTHER_ENTERTAINMENT", source: "user" },
    ];

    const [result] = await categorizeTransactions(
      [txn("NETFLIX.COM", { categoryDetailed: "ENTERTAINMENT_TV_AND_MOVIES" })],
      db,
    );

    expect(result.category?.detailed).toBe("ENTERTAINMENT_OTHER_ENTERTAINMENT");
    expect(result.categorySource).toBe("user");
  });

  // Founder 10-30: a prop firm's payout the bank filed as a transfer is income (./rules.ts).
  it("takes a payout the bank called a transfer as income, and leaves the bank's income alone", async () => {
    const [payout, income, fee] = await categorizeTransactions(
      [
        txn("LUCID TRADING PAYOUT", {
          amountCents: -150_000,
          categoryDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
        }),
        txn("LUCID TRADING PAYOUT 2", {
          amountCents: -150_000,
          categoryDetailed: "INCOME_OTHER",
        }),
        txn("LUCID TRADING RESET", {
          amountCents: 8_500,
          categoryDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        }),
      ],
      db,
    );
    expect(payout).toMatchObject({
      category: { detailed: "INCOME_CONTRACTOR" },
      categorySource: "rule",
    });
    expect(income).toMatchObject({
      category: { detailed: "INCOME_OTHER" },
      categorySource: "plaid",
    });
    expect(fee).toMatchObject({
      category: { detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" },
      categorySource: "plaid",
    });
  });

  it("keeps a category the source already gave", async () => {
    const [result] = await categorizeTransactions(
      [txn("NETFLIX.COM", { categoryDetailed: "ENTERTAINMENT_OTHER_ENTERTAINMENT" })],
      db,
    );

    expect(result.category?.detailed).toBe("ENTERTAINMENT_OTHER_ENTERTAINMENT");
    expect(result.categorySource).toBe("plaid");
  });

  it("uses the cache before the LLM, then caches new LLM answers", async () => {
    cache = [
      { merchantKey: "corner stall", pfcDetailed: "FOOD_AND_DRINK_GROCERIES", source: "llm" },
    ];
    vi.mocked(classifyMerchants).mockResolvedValue(
      new Map([["fancy studio", "PERSONAL_CARE_HAIR_AND_BEAUTY"]]),
    );

    const results = await categorizeTransactions(
      [txn("CORNER STALL 0042"), txn("FANCY STUDIO"), txn("CORNER STALL 0042 #2")],
      db,
    );

    expect(classifyMerchants).toHaveBeenCalledWith(["fancy studio"]);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user_1",
          merchantKey: "fancy studio",
          pfcPrimary: "PERSONAL_CARE",
          pfcDetailed: "PERSONAL_CARE_HAIR_AND_BEAUTY",
          source: "llm",
        },
      ],
      skipDuplicates: true,
    });
    expect(results.map((r) => [r.category?.detailed, r.categorySource])).toEqual([
      ["FOOD_AND_DRINK_GROCERIES", "llm"],
      ["PERSONAL_CARE_HAIR_AND_BEAUTY", "llm"],
      ["FOOD_AND_DRINK_GROCERIES", "llm"],
    ]);
  });

  it("leaves a transaction uncategorized when nothing can place it", async () => {
    const [result] = await categorizeTransactions([txn("MYSTERY SHOP")], db);

    expect(result.category).toBeNull();
    expect(result.categorySource).toBeNull();
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("an upload's categories, quickly", () => {
  beforeEach(() => {
    cache = [];
    createMany.mockReset().mockResolvedValue({ count: 0 });
    vi.mocked(classifyMerchants).mockReset().mockResolvedValue(new Map());
  });

  it("uses the cache but never waits on Claude with askClaude: false", async () => {
    cache = [
      { merchantKey: "corner stall", pfcDetailed: "FOOD_AND_DRINK_GROCERIES", source: "llm" },
    ];
    const results = await categorizeTransactions(
      [txn("CORNER STALL 0042"), txn("FANCY STUDIO")],
      db,
      { askClaude: false },
    );
    expect(classifyMerchants).toHaveBeenCalledWith([]);
    expect(results.map((r) => r.category?.detailed ?? null)).toEqual([
      "FOOD_AND_DRINK_GROCERIES",
      null,
    ]);
  });

  it("sorts what's left after the upload, one update per category", async () => {
    vi.mocked(classifyMerchants).mockResolvedValue(
      new Map([
        ["fancy studio", "PERSONAL_CARE_HAIR_AND_BEAUTY"],
        ["blue lantern", "FOOD_AND_DRINK_RESTAURANT"],
      ]),
    );
    const rows = ["FANCY STUDIO", "BLUE LANTERN 101", "BLUE LANTERN 101", "MYSTERY SHOP"].map(
      (description, i) => ({
        id: `t${i}`,
        accountId: "acct_1",
        date: new Date("2026-09-01T00:00:00Z"),
        description,
        amountCents: 1200,
      }),
    );
    const updateMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    }));
    const transactions = { findMany: vi.fn(async () => rows), updateMany };

    const changed = await categorizeLeftovers({ ...db, transactions } as never);

    expect(transactions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pfcDetailed: null, categorySource: null } }),
    );
    expect(changed).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] }, pfcDetailed: null },
      data: {
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_RESTAURANT",
        categorySource: "llm",
      },
    });
  });

  it("does nothing when every row has a category", async () => {
    const transactions = { findMany: vi.fn(async () => []), updateMany: vi.fn() };
    expect(await categorizeLeftovers({ ...db, transactions } as never)).toBe(0);
    expect(classifyMerchants).not.toHaveBeenCalled();
  });
});
