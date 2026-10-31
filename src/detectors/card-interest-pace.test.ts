import { describe, expect, it } from "vitest";
import { addDays, DAYS_PER_MONTH } from "@/detection/units";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// Review 10-31: the dock's card-interest figure scaled to a year differently from the report's
// finding (src/detection/rules/fee-totals.ts), so a 7-month history read $2,546 a year in the
// dock and $1,464 on the report; and one card from a statement file dropped the known cards'
// figure for the charges seen. Both now count as the report does (paceMonths).

const interestOf = (d: ProfileInput) =>
  d.transactions.filter((t) => t.pfc === "BANK_FEES_INTEREST_CHARGE" && t.amountCents > 0);
const sum = (list: { amountCents: number }[]) => list.reduce((s, t) => s + t.amountCents, 0);
const worth = (d: ProfileInput) =>
  runDetectors({ profile: buildProfile(d), data: d }).find((s) => s.topic === "card_interest")
    ?.worthCents;
// The "debt" sample person, the last `days` of their history, card balances and rates unknown.
const lastDays = (days: number): ProfileInput => {
  const d = inputFor("debt");
  const from = addDays(d.today, -days);
  return {
    ...d,
    transactions: d.transactions.filter((t) => t.date >= from),
    extras: { ...d.extras, cardInterestYearCents: null },
  };
};

describe("card interest, counted as the report counts it", () => {
  it("takes a history of seven months as it is, as the report does", () => {
    const d = lastDays(209);
    expect(worth(d)).toBe(sum(interestOf(d)));
  });

  it("puts a short history at a year's pace, in the report's months", () => {
    const d = lastDays(99);
    const first = d.transactions.reduce((m, t) => (t.date < m ? t.date : m), d.today);
    const days = Math.round((Date.parse(d.today) - Date.parse(first)) / 86_400_000);
    const months = Math.round(days / DAYS_PER_MONTH);
    expect(worth(d)).toBe(Math.round((sum(interestOf(d)) * 12) / months));
  });

  it("adds a statement-file card's charges seen to the known cards' figure", () => {
    const d = inputFor("debt");
    const card = interestOf(d)[0].accountId;
    const seen = sum(interestOf(d).filter((t) => t.accountId === card));
    const mixed = {
      ...d,
      extras: { ...d.extras, cardInterestYearCents: 150_000, cardInterestUnknownCards: [card] },
    };
    expect(worth(mixed)).toBe(150_000 + seen);
  });
});
