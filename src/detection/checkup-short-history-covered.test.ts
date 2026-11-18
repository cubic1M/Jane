import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, GROCERIES, input, tx } from "./__fixtures__/build";
import { checkup } from "./checkup";
import { addDays } from "./units";

// Debugger 11-18 (r350, one month of Chase checking, Oct 15 to Nov 14, uploaded Nov 18, on a
// phone): the report said "Your statements cover 31 days", and under it each short check said
// "Jane has 34 days of statements; this check needs 60". The 34 ran to today; the statements
// cover 31. Whether a check has enough is unchanged; the line says the days they cover.

function oneMonthEndingFourDaysAgo() {
  const transactions = [];
  for (let back = 34; back >= 4; back -= 3) {
    transactions.push(
      tx({ ...GROCERIES, accountId: CHECKING.id, date: addDays(AS_OF, -back), amountCents: 3_000 }),
    );
  }
  return input({ accounts: [{ ...CHECKING, currentBalanceCents: 87_738 }], transactions });
}

describe("a check that needs more history", () => {
  it("says the days the statements cover", () => {
    const sub = checkup(oneMonthEndingFourDaysAgo()).find((l) => l.label === "Subscriptions");
    expect(sub?.detail).toBe("Jane has 31 days of statements; this check needs 60.");
  });
});
