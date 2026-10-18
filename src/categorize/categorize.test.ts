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

const findMany = vi.fn();
const createMany = vi.fn();
const db = { userId: "user_1", merchantCategories: { findMany, createMany } } as unknown as Pick<
  ScopedDb,
  "userId" | "merchantCategories"
>;

describe("categorizeTransactions", () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    createMany.mockReset().mockResolvedValue({ count: 0 });
    vi.mocked(classifyMerchants).mockReset().mockResolvedValue(new Map());
  });

  it("uses rules first and never asks the LLM about rule matches", async () => {
    const [result] = await categorizeTransactions([txn("NETFLIX.COM")], db);

    expect(result.category?.detailed).toBe("ENTERTAINMENT_TV_AND_MOVIES");
    expect(result.categorySource).toBe("rule");
    expect(findMany).not.toHaveBeenCalled();
    expect(classifyMerchants).not.toHaveBeenCalled();
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
    findMany.mockResolvedValue([
      { merchantKey: "corner market", pfcDetailed: "FOOD_AND_DRINK_GROCERIES" },
    ]);
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
