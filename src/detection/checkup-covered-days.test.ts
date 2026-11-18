import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, GROCERIES, input, tx } from "./__fixtures__/build";
import { checkup } from "./checkup";
import { addDays } from "./units";

// Debugger 11-17 (r337, one month of Chase checking, Oct 15 to Nov 14, uploaded on Nov 17 on a
// phone): the report said "Your statements cover 31 days" and, under it, "Double charges: None in
// 33 days" and "Trials turned paid: None in 33 days". The 33 ran to today, three days no statement
// reached. A "None in …" line speaks for the days the statements cover.

// Groceries every few days from 33 days ago to 3 days ago: 31 days of statements.
function oneMonthEndingThreeDaysAgo() {
  const transactions = [];
  for (let back = 33; back >= 3; back -= 3) {
    transactions.push(
      tx({ ...GROCERIES, accountId: CHECKING.id, date: addDays(AS_OF, -back), amountCents: 3_000 }),
    );
  }
  return input({ accounts: [{ ...CHECKING, currentBalanceCents: 87_738 }], transactions });
}

const line = (label: string) =>
  checkup(oneMonthEndingThreeDaysAgo()).find((l) => l.label === label)?.line;

describe("what a passed check says it looked at", () => {
  it("is the days the statements cover, not the days to today", () => {
    expect(line("Double charges")).toBe("None in 31 days");
    expect(line("Trials turned paid")).toBe("None in 31 days");
  });
});
