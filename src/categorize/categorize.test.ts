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

    expect(classifyMerchants).toHaveBeenCalledWith(["fancy studio"], { claude: undefined });
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

  // Debugger 11-02: Claude says what a typical purchase at a merchant is, and that was put on money
  // coming in too: a freelancer's $6,000 invoice from a clinic would be a medical refund, taken off
  // their spending.
  describe("Claude's answer, on money coming in", () => {
    const answer = () =>
      vi
        .mocked(classifyMerchants)
        .mockResolvedValue(new Map([["bright path clinic", "MEDICAL_PRIMARY_CARE"]]));

    it("isn't put on a big deposit", async () => {
      answer();
      const [deposit] = await categorizeTransactions(
        [txn("BRIGHT PATH CLINIC", { amountCents: -600_000 })],
        db,
      );
      expect(deposit.category).toBeNull();
      expect(deposit.categorySource).toBeNull();
    });

    it("is put on a small one: a refund", async () => {
      answer();
      const [refund] = await categorizeTransactions(
        [txn("BRIGHT PATH CLINIC", { amountCents: -4_500 })],
        db,
      );
      expect(refund.category?.detailed).toBe("MEDICAL_PRIMARY_CARE");
      expect(refund.categorySource).toBe("llm");
    });

    it("is put on money going out", async () => {
      answer();
      const [paid] = await categorizeTransactions(
        [txn("BRIGHT PATH CLINIC", { amountCents: 600_000 })],
        db,
      );
      expect(paid.category?.detailed).toBe("MEDICAL_PRIMARY_CARE");
    });

    it("is what the cache holds too, not put on a big deposit", async () => {
      cache = [
        { merchantKey: "bright path clinic", pfcDetailed: "MEDICAL_PRIMARY_CARE", source: "llm" },
      ];
      const [deposit] = await categorizeTransactions(
        [txn("BRIGHT PATH CLINIC", { amountCents: -600_000 })],
        db,
      );
      expect(deposit.category).toBeNull();
    });
  });

  it("leaves a transaction uncategorized when nothing can place it", async () => {
    const [result] = await categorizeTransactions([txn("MYSTERY SHOP")], db);

    expect(result.category).toBeNull();
    expect(result.categorySource).toBeNull();
    expect(createMany).not.toHaveBeenCalled();
  });
});

// The metamorphic suite: the same statement gave different totals by which bank's columns it came in.
describe("a refund of a charge in the same batch", () => {
  const FURNITURE = { categoryDetailed: "HOME_IMPROVEMENT_FURNITURE" };
  const refund = (extra: Partial<NormalizedTransaction> = {}) =>
    txn("ZORBLAX GOODS", { amountCents: -4321, date: "2026-10-05", externalId: "back", ...extra });
  const categorize = async (rows: NormalizedTransaction[]) => {
    cache = [];
    vi.mocked(classifyMerchants).mockResolvedValue(new Map());
    return categorizeTransactions(rows, db, { askClaude: false });
  };

  it("gives a refund its charge's category, so that it nets against it", async () => {
    const [, back] = await categorize([
      txn("ZORBLAX GOODS", { amountCents: 4321, ...FURNITURE }),
      refund(),
    ]);
    expect(back?.category?.detailed).toBe("HOME_IMPROVEMENT_FURNITURE");
    expect(back?.categorySource).toBe("rule");
  });

  it("nets a refund even when neither side has a category", async () => {
    const [charge, back] = await categorize([
      txn("ZORBLAX GOODS", { amountCents: 4321 }),
      refund(),
    ]);
    expect(charge?.category).toBeNull();
    expect(back?.category?.primary).toBe("GENERAL_MERCHANDISE");
  });

  it("doesn't read a refund under Capital One's Payment/Credit as paying the card", async () => {
    const hints = { bankCategory: "Payment/Credit" };
    const [, back, paid] = await categorize([
      txn("ZORBLAX GOODS", { amountCents: 4321, ...FURNITURE }),
      refund({ hints }),
      txn("CAPITAL ONE MOBILE PYMT", { amountCents: -50_000, hints, externalId: "paid" }),
    ]);
    expect(back?.category?.detailed).toBe("HOME_IMPROVEMENT_FURNITURE");
    expect(paid?.category?.detailed).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  it("leaves money in that can't be a refund of what was bought there", async () => {
    const charge = txn("ZORBLAX GOODS", { amountCents: 4321, ...FURNITURE });
    // More than was ever charged, before any charge, and too big to be a refund at all.
    const [, more] = await categorize([charge, refund({ amountCents: -4322 })]);
    expect(more?.category).toBeNull();
    const [, early] = await categorize([charge, refund({ date: "2026-09-01" })]);
    expect(early?.category).toBeNull();
    const big = txn("ZORBLAX GOODS", { amountCents: 60_000, ...FURNITURE });
    const [, pay] = await categorize([big, refund({ amountCents: -50_000 })]);
    expect(pay?.category).toBeNull();
    // Money out that isn't buying anything isn't refunded by money in at that name.
    const [, loan] = await categorize([
      txn("ZORBLAX GOODS", { amountCents: 4321, categoryDetailed: "LOAN_PAYMENTS_OTHER_PAYMENT" }),
      refund(),
    ]);
    expect(loan?.category).toBeNull();
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
    expect(classifyMerchants).toHaveBeenCalledWith([], { claude: undefined });
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
