import { describe, expect, it } from "vitest";
import { loansIntro } from "./loans";

// Debugger 11-14: a student whose checking statement paid a Chase card $1,304.41 read "No loans,
// cards or plans yet" on Loans & credit. There's a card; Jane just can't see it yet.

const empty = { debts: [], totalOwedCents: 0, monthlyCents: 0 };

describe("an empty Loans page", () => {
  it("asks for the card's statement when checking pays a card", () => {
    expect(loansIntro({ ...empty, cardPaidNotOnFile: true })).toBe(
      "No loans yet. You pay a credit card from checking: add its statement to see its balance and what it charges.",
    );
  });

  it("says there's nothing yet when nothing is paid to a card", () => {
    expect(loansIntro(empty)).toBe("No loans, cards or plans yet.");
  });
});
