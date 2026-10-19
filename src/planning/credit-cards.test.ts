import { describe, expect, it } from "vitest";
import { CARD_BETTER_MIN_CENTS } from "@/config/credit-cards";
import { DEMO_CARDS } from "@/data-sources/demo/demo-credit-cards";
import type { InsightTransaction } from "@/insights/spending";
import {
  betterCards,
  earnsCents,
  feeCheck,
  rewardCategoryOf,
  wallet,
  yearSpend,
  type Spend,
} from "./credit-cards";

const card = (id: string) => DEMO_CARDS.find((c) => c.id === id)!;
const dine = card("demo-dine-plus");
const flat = card("fern-flat-2");
const grocer = card("harbor-grocer");

const tx = (
  date: string,
  amountCents: number,
  pfcPrimary: string,
  pfcDetailed: string,
): InsightTransaction => ({
  date,
  amountCents,
  description: "x",
  merchantName: null,
  pfcPrimary,
  pfcDetailed,
  pending: false,
});

const spend = (s: Partial<Spend>): Spend => ({
  dining: 0,
  groceries: 0,
  gas: 0,
  travel: 0,
  streaming: 0,
  online: 0,
  other: 0,
  ...s,
});

describe("the kind of spending a purchase is", () => {
  it("reads Plaid's categories, detailed first", () => {
    expect(
      rewardCategoryOf({ pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_GROCERIES" }),
    ).toBe("groceries");
    expect(
      rewardCategoryOf({ pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_COFFEE" }),
    ).toBe("dining");
    expect(
      rewardCategoryOf({ pfcPrimary: "TRANSPORTATION", pfcDetailed: "TRANSPORTATION_GAS" }),
    ).toBe("gas");
    expect(rewardCategoryOf({ pfcPrimary: "MEDICAL", pfcDetailed: "MEDICAL_DENTAL_CARE" })).toBe(
      "other",
    );
  });

  it("leaves out what a card can't earn on: fees, loans, rent, taxes and transfers", () => {
    for (const [primary, detailed] of [
      ["BANK_FEES", "BANK_FEES_OVERDRAFT_FEES"],
      ["LOAN_PAYMENTS", "LOAN_PAYMENTS_BNPL"],
      ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"],
      ["GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"],
      ["TRANSFER_OUT", "TRANSFER_OUT_SAVINGS"],
    ]) {
      expect(rewardCategoryOf({ pfcPrimary: primary, pfcDetailed: detailed })).toBeNull();
    }
  });
});

describe("a year of the person's own spending", () => {
  it("adds up a year by kind, refunds netted, nothing older or pending", () => {
    const year = yearSpend(
      [
        tx("2025-10-01", 99_999, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"), // too old
        tx("2025-10-20", 5_000, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"),
        tx("2026-05-01", 12_000, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
        tx("2026-05-02", -2_000, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"), // refund
        tx("2026-06-01", 85_000, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
        { ...tx("2026-10-17", 4_000, "TRANSPORTATION", "TRANSPORTATION_GAS"), pending: true },
      ],
      "2026-10-18",
    );
    expect(year.byCategory).toMatchObject({ dining: 5_000, groceries: 10_000, gas: 0 });
    expect(year.totalCents).toBe(15_000);
    expect(year.days).toBe(364);
  });

  it("scales a shorter history up to a year", () => {
    const year = yearSpend(
      [tx("2026-07-21", 10_000, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")],
      "2026-10-18",
    );
    expect(year.days).toBe(90);
    expect(year.byCategory.groceries).toBe(Math.round((10_000 * 365) / 90));
  });
});

describe("what each card earns, the fee always counted", () => {
  const s = spend({ dining: 300_000, groceries: 500_000, other: 700_000 });

  it("pays each kind at its own rate", () => {
    // 3% of $3,000 + 1% of $5,000 + 1% of $7,000.
    expect(earnsCents(dine, s)).toBe(9_000 + 5_000 + 7_000);
    expect(earnsCents(flat, s)).toBe(30_000);
  });

  it("uses the best card for each kind and takes every fee off", () => {
    const w = wallet([dine, flat], s);
    expect(w.picks.find((p) => p.category === "dining")!.cardId).toBe(dine.id);
    expect(w.picks.find((p) => p.category === "groceries")!.cardId).toBe(flat.id);
    expect(w.earnsCents).toBe(9_000 + 10_000 + 14_000);
    expect(w.feesCents).toBe(9_500);
    expect(w.netCents).toBe(33_000 - 9_500);
  });

  it("gives a tie to the card without a fee", () => {
    const w = wallet([dine, flat], s);
    // Travel: both earn 2%.
    expect(w.picks.find((p) => p.category === "travel")!.cardId).toBe(flat.id);
  });

  it("says when a fee doesn't pay for itself against the best no-fee card", () => {
    const check = feeCheck(dine, s, DEMO_CARDS)!;
    expect(check.earnsCents).toBe(21_000);
    expect(check.netCents).toBe(21_000 - 9_500);
    expect(check.noFee!.card.id).toBe(flat.id);
    expect(check.paysForItself).toBe(false);
    // With a lot of dining, it does.
    expect(feeCheck(dine, spend({ dining: 2_000_000 }), DEMO_CARDS)!.paysForItself).toBe(true);
    expect(feeCheck(flat, s, DEMO_CARDS)).toBeNull();
  });
});

describe("a card that would earn more", () => {
  const s = spend({ dining: 300_000, groceries: 500_000, gas: 100_000, other: 700_000 });
  const total = 1_600_000;

  it("counts only what it adds to the person's cards, after its fee", () => {
    const better = betterCards([dine], DEMO_CARDS, s, total);
    const fern = better.find((b) => b.card.id === flat.id)!;
    // 1% more on groceries, gas and everything else.
    expect(fern.gainCents).toBe(5_000 + 1_000 + 7_000);
    expect(fern.usedFor).toEqual(["groceries", "gas", "other"]);
    expect(better[0].gainCents).toBeGreaterThanOrEqual(better.at(-1)!.gainCents);
    // A $550 fee for 5x travel the person doesn't spend on is never offered.
    expect(better.some((b) => b.card.id === "summit-premier")).toBe(false);
  });

  it("is used only where it earns more, not where it ties", () => {
    const withTravel = { ...s, travel: 200_000 };
    const fern = betterCards([dine], DEMO_CARDS, withTravel, total).find(
      (b) => b.card.id === flat.id,
    )!;
    // Both earn 2% on travel.
    expect(fern.usedFor).not.toContain("travel");
  });

  it("never offers a card the person has, or one that adds too little", () => {
    const better = betterCards([dine, flat, grocer], DEMO_CARDS, s, total);
    expect(better.every((b) => b.gainCents >= CARD_BETTER_MIN_CENTS)).toBe(true);
    expect(better.some((b) => [dine.id, flat.id, grocer.id].includes(b.card.id))).toBe(false);
  });

  it("says whether usual spending reaches the sign-up bonus in time", () => {
    const fern = betterCards([dine], DEMO_CARDS, s, total).find((b) => b.card.id === flat.id)!;
    // $16,000 a year is $4,000 in three months: past the $500 needed.
    expect(fern.introReachable).toBe(true);
    // $1,600 a year is $400 in three months: short of it.
    const light = betterCards([dine], DEMO_CARDS, s, 160_000).find((b) => b.card.id === flat.id)!;
    expect(light.introReachable).toBe(false);
  });
});
