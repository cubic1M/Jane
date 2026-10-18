import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm", () => ({ classifyMerchants: vi.fn() }));

import { categorizeTransactions } from "./categorize";
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
      { merchantKey: "corner market", pfcDetailed: "FOOD_AND_DRINK_GROCERIES", source: "llm" },
    ];
    vi.mocked(classifyMerchants).mockResolvedValue(
      new Map([["fancy salon", "PERSONAL_CARE_HAIR_AND_BEAUTY"]]),
    );

    const results = await categorizeTransactions(
      [txn("CORNER MARKET 0042"), txn("FANCY SALON"), txn("CORNER MARKET 0042 #2")],
      db,
    );

    expect(classifyMerchants).toHaveBeenCalledWith(["fancy salon"]);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user_1",
          merchantKey: "fancy salon",
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
