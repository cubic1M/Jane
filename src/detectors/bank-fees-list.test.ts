import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { bankFeesOf, FEE_LIST_PATH } from "./bank-fees-of";
import { runDetectors } from "./index";

// Debug 2, sweep 16 (11-22, upload S6): "Stop paying overdraft and bank fees, save $139/yr" counted
// 7 fees, and "See the fees" opened Where your money goes, which lists categories, none of the
// fees. It opens the fee list now, whose lines are the card's own: that many, adding up to its total.

const tx = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId = "chk",
): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId,
});
const pay = (date: string) => tx(date, -62_525, "UNIV OF CALIF PAYROLL", "INCOME_WAGES");

// S6's fees: a $10 monthly fee four times and two $35 overdrafts on checking, a $29 late fee on the
// card, from a year of statements.
const s6: ProfileInput = {
  today: "2026-11-21",
  accounts: [
    {
      id: "chk",
      type: "depository",
      subtype: "checking",
      balanceCents: 141_222,
      balanceKnown: true,
    },
    {
      id: "card",
      type: "credit",
      subtype: "credit card",
      balanceCents: 185_040,
      balanceKnown: true,
    },
  ],
  liabilities: [],
  told: {},
  transactions: [
    pay("2025-11-28"),
    tx("2026-01-31", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
    tx("2026-02-28", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
    tx("2026-03-12", 3_500, "OVERDRAFT FEE FOR A $4.50 ITEM", "BANK_FEES_OVERDRAFT_FEES"),
    tx("2026-03-31", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
    tx("2026-04-30", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
    tx("2026-06-18", 3_500, "OVERDRAFT FEE FOR A $12.10 ITEM", "BANK_FEES_OVERDRAFT_FEES"),
    tx("2026-08-31", 2_900, "LATE FEE", "BANK_FEES_LATE_FEES", "card"),
    pay("2026-11-13"),
  ],
};

describe("the bank-fees card and the fee list it opens", () => {
  it("lists the 7 fees the card counts, adding up to its $139.00", () => {
    const fees = bankFeesOf(s6)!;
    expect(fees).toMatchObject({ seenCents: 13_900, count: 7 });
    expect(fees.lines.map((l) => [l.date, l.amountCents])).toEqual([
      ["2026-08-31", 2_900],
      ["2026-06-18", 3_500],
      ["2026-04-30", 1_000],
      ["2026-03-31", 1_000],
      ["2026-03-12", 3_500],
      ["2026-02-28", 1_000],
      ["2026-01-31", 1_000],
    ]);
    const card = runDetectors({ profile: buildProfile(s6), data: s6 }).find(
      (s) => s.topic === "bank_fees",
    );
    expect(card?.action).toEqual({ label: "See the fees", href: FEE_LIST_PATH });
    expect(card?.short).toBe("You paid $139.00 in 7 bank fees in a year.");
  });

  it("says what was paid, not a year of it, when one account's fees are paced", () => {
    // Uploads of a year of checking and a card from Sep: an uploaded file is paced over its own days,
    // so the card's two late fees are paced to a year in the headline, but what was paid is what the
    // list adds up to.
    const data: ProfileInput = {
      ...s6,
      transactions: [
        pay("2025-11-01"),
        tx("2026-03-31", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
        tx("2026-09-02", 4_000, "AMAZON", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", "card"),
        tx("2026-09-30", 2_900, "LATE FEE", "BANK_FEES_LATE_FEES", "card"),
        tx("2026-10-31", 2_900, "LATE FEE", "BANK_FEES_LATE_FEES", "card"),
        pay("2026-11-13"),
      ].map((t) => ({ ...t, uploadedOn: "2026-11-21" })),
    };
    const fees = bankFeesOf(data)!;
    expect(fees.seenCents).toBe(6_800);
    expect(fees.yearCents).toBeGreaterThan(fees.seenCents);
    const card = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "bank_fees",
    );
    expect(card?.short).toBe("You paid $68.00 in 3 bank fees in a year.");
  });
});
