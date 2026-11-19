import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, GROCERIES, input, tx } from "./__fixtures__/build";
import { checkup } from "./checkup";
import { addDays } from "./units";

// Debugger 11-19 (r364, three months of Capital One 360 checking ending Sep 28, on a phone): the
// report's "Idle cash" and "Balance ahead" said "That's too long ago to say what you're paying
// now", though both are about the cash held, not what's paid.

// Groceries every few days for three months, ending 50 days ago.
function oldStatements() {
  const transactions = [];
  for (let back = 140; back >= 50; back -= 4) {
    transactions.push(
      tx({ ...GROCERIES, accountId: CHECKING.id, date: addDays(AS_OF, -back), amountCents: 4_000 }),
    );
  }
  return input({ accounts: [{ ...CHECKING, currentBalanceCents: 195_016 }], transactions });
}

const detail = (label: string) => checkup(oldStatements()).find((l) => l.label === label)?.detail;

describe("why a check waits on old statements", () => {
  it.each(["Idle cash", "Balance ahead"])("%s says what's held", (label) => {
    expect(detail(label)).toMatch(/^That's too long ago to say what you're holding now\./);
  });

  it("a check about payments still says what's paid", () => {
    expect(detail("Subscriptions")).toMatch(/^That's too long ago to say what you're paying now\./);
  });
});
