import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { moneyTiles, type MoneyData } from "./money";

// The Money hub's tiles (spec step 80).

const FULL: MoneyData = {
  hasAccounts: true,
  month: "2026-10",
  netWorth: {
    assetsCents: 50_000_00,
    investmentsCents: 20_000_00,
    ownedCents: 0,
    cryptoCents: 0,
    debtsCents: 10_000_00,
    netCents: 40_000_00,
    missing: [],
    unbalanced: [],
  },
  hasInvestmentAccounts: true,
  owned: { count: 0 },
  assetPrompt: { kind: "home", loanId: "loan-1" },
  goals: { total: 3, onTrack: 2 },
  spendingCents: 2_345_67,
  budgets: { total: 4, over: 1, daysLeft: 13 },
  recurring: { count: 12, yearlyCents: 4_800_00 },
  debt: { accounts: 2, owedCents: 10_000_00 },
  documents: 1,
  insurance: { policies: 2, gaps: 1 },
};

const EMPTY: MoneyData = {
  hasAccounts: false,
  month: "2026-10",
  netWorth: {
    assetsCents: 0,
    investmentsCents: 0,
    ownedCents: 0,
    cryptoCents: 0,
    debtsCents: 0,
    netCents: 0,
    missing: [],
    unbalanced: [],
  },
  hasInvestmentAccounts: false,
  owned: { count: 0 },
  assetPrompt: null,
  goals: { total: 0, onTrack: 0 },
  spendingCents: 0,
  budgets: { total: 0, over: 0, daysLeft: 0 },
  recurring: { count: 0, yearlyCents: 0 },
  debt: { accounts: 0, owedCents: 0 },
  documents: 0,
  insurance: { policies: 0, gaps: 0 },
};

const byLabel = (data: MoneyData) =>
  Object.fromEntries(
    moneyTiles(data)
      .flatMap((g) => g.tiles)
      .map((t) => [t.label, t]),
  );

describe("moneyTiles", () => {
  it("groups the tiles in the agreed order", () => {
    expect(moneyTiles(FULL).map((g) => [g.title, g.tiles.map((t) => t.label)])).toEqual([
      ["What you have", ["Net worth", "Investments", "Things you own", "Goals"]],
      ["What goes out", ["Spending", "Budgets", "Bills and subscriptions", "Transactions"]],
      ["What you owe", ["Loans and cards"]],
      ["Your files", ["Documents", "Insurance"]],
    ]);
  });

  it("shows one live number per tile, linked to its page", () => {
    const t = byLabel(FULL);
    expect(t["Net worth"]).toMatchObject({ href: "/net-worth", value: "$40,000.00" });
    expect(t["Investments"]).toMatchObject({ href: "/investments", value: "$20,000.00" });
    expect(t["Goals"]).toMatchObject({ value: "2 on track", status: "Of 3 goals" });
    expect(t["Spending"]).toMatchObject({
      href: "/insights",
      value: "$2,345.67",
      status: "So far in October",
    });
    expect(t["Budgets"]).toMatchObject({
      value: "1 over",
      status: "4 budgets, 13 days left this month",
    });
    expect(t["Bills and subscriptions"]).toMatchObject({
      href: "/subscriptions",
      value: "12",
      status: "Regular charges, $4,800.00 a year",
      more: { href: "/bills", label: "Coming up" },
    });
    expect(t["Transactions"]).toMatchObject({ href: "/transactions", value: null });
    expect(t["Loans and cards"]).toMatchObject({
      href: "/loans",
      value: "$10,000.00",
      status: "Owed across 2 accounts",
    });
    expect(t["Documents"]).toMatchObject({ href: "/documents", value: "1" });
    expect(t["Insurance"]).toMatchObject({
      href: "/insurance",
      value: "2",
      status: "1 gap in your cover",
    });
  });

  it("says the insurance tile's state without gaps (spec step 102)", () => {
    expect(byLabel({ ...FULL, insurance: { policies: 2, gaps: 0 } })["Insurance"].status).toBe(
      "Every policy in one place",
    );
    expect(byLabel(EMPTY)["Insurance"]).toMatchObject({ value: null, status: "Add your policies" });
  });

  it("asks for the home when there's a mortgage and nothing linked", () => {
    expect(byLabel(FULL)["Things you own"]).toEqual({
      label: "Things you own",
      href: "/things?kind=home&loan=loan-1",
      value: null,
      status: "Add your home",
    });
    expect(
      byLabel({ ...FULL, assetPrompt: { kind: "vehicle", loanId: "car" } })["Things you own"]
        .status,
    ).toBe("Add your car");
  });

  it("shows what's owned once something is", () => {
    const t = byLabel({
      ...FULL,
      owned: { count: 1 },
      netWorth: { ...FULL.netWorth, ownedCents: 300_000_00 },
    });
    expect(t["Things you own"]).toMatchObject({
      href: "/things",
      value: "$300,000.00",
      status: "1 thing, at your values",
    });
  });

  it("says all on track when no budget is over", () => {
    expect(
      byLabel({ ...FULL, budgets: { total: 1, over: 0, daysLeft: 1 } })["Budgets"],
    ).toMatchObject({ value: "All on track", status: "1 budget, 1 day left this month" });
  });

  it("has a friendly empty state for every tile, and no investments tile without any", () => {
    const t = byLabel(EMPTY);
    expect(t["Investments"]).toBeUndefined();
    expect(t["Net worth"]).toMatchObject({ value: null, status: "Add your accounts to see it" });
    expect(t["Things you own"]).toMatchObject({ value: null, href: "/things" });
    expect(t["Goals"]).toMatchObject({ value: null, status: "Set one to save toward" });
    expect(t["Spending"]).toMatchObject({ value: null });
    expect(t["Budgets"]).toMatchObject({ value: null, status: "Set a monthly budget" });
    expect(t["Bills and subscriptions"]).toMatchObject({ value: null });
    expect(t["Loans and cards"]).toMatchObject({ value: null, status: "No loans or cards linked" });
    expect(t["Documents"]).toMatchObject({ value: null, status: "Add a policy or receipt" });
  });

  it("never gives advice or recommends in its copy", () => {
    for (const data of [FULL, EMPTY]) {
      for (const tile of moneyTiles(data).flatMap((g) => g.tiles)) {
        const text = `${tile.status}.`;
        expect(recommendsAChoice(text), text).toBe(false);
        // The Investments tile names the account type and shows its balance, as /net-worth
        // does (spec step 66: balances only), so the word itself is expected there.
        if (tile.label === "Investments") continue;
        const figures = dollarFigures(text).map((f) => f.cents);
        expect(checkGuardrails(text, figures), text).toEqual({ ok: true });
      }
    }
  });
});
