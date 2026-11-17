import { describe, expect, it } from "vitest";
import { loansIntro } from "./loans";

// Debugger 11-16 (r319, a Chase checking upload on a phone, paying Nelnet $214.37 and Toyota Motor
// Credit $338.12): after typing what's left on Nelnet, Loans read "You owe $18,400.00, $552.49 due
// each month." The $552.49 counts Toyota's payment, the $18,400.00 leaves its balance out, and
// nothing said so. A total missing a balance says "at least" and names what it's missing.

const debt = (key: string, name: string, balanceCents: number | null) => ({
  key,
  name,
  balanceCents,
  inNetWorth: false,
});

describe("what Loans says you owe when a balance isn't known", () => {
  it("says at least, and names the loan it can't count", () => {
    expect(
      loansIntro({
        debts: [
          debt("paid:student:nelnet student loan", "Nelnet Student Loan", 1_840_000),
          debt("paid:auto:toyota motor credit", "Toyota Motor Credit car loan", null),
        ],
        totalOwedCents: 1_840_000,
        monthlyCents: 55_249,
      }),
    ).toBe(
      "You owe at least $18,400.00, $552.49 due each month. What's left on Toyota Motor Credit car loan isn't known yet. Open a branch to see more.",
    );
  });

  it("counts them past two", () => {
    expect(
      loansIntro({
        debts: [
          debt("paid:student:nelnet", "Nelnet", 1_840_000),
          debt("paid:auto:toyota", "Toyota", null),
          debt("paid:student:mohela", "Mohela", null),
          debt("paid:loan:upstart", "Upstart", null),
        ],
        totalOwedCents: 1_840_000,
        monthlyCents: 0,
      }),
    ).toContain("What's left on 3 debts isn't known yet.");
  });

  it("is the plain total when every balance is known", () => {
    expect(
      loansIntro({
        debts: [debt("paid:student:nelnet", "Nelnet", 1_840_000)],
        totalOwedCents: 1_840_000,
        monthlyCents: 21_437,
      }),
    ).toBe("You owe $18,400.00, $214.37 due each month. Open a branch to see more.");
  });
});
