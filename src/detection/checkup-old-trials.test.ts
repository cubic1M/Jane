import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, GROCERIES, input, tx } from "./__fixtures__/build";
import { checkup } from "./checkup";
import { addDays } from "./units";

// Debugger 11-17 (r339, three months of Capital One 360 checking ending Sep 28, uploaded on Nov
// 17 on a phone): the report said "Your statements end Sep 28, 2026" for every check about what's
// paid now, but "Trials turned paid: None in 60 days". A trial counts only when its full charge is
// within 60 days of today, and the statements reach eleven of those days, so it can't say none.

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

const trials = (lines = checkup(oldStatements())) =>
  lines.find((l) => l.label === "Trials turned paid");

describe("trials turned paid on old statements", () => {
  it("says when the statements end instead of passing", () => {
    expect(trials()?.status).toBe("not_enough_data");
    expect(trials()?.line).toMatch(/^Your statements end /);
  });

  it("still passes on statements that reach today", () => {
    const fresh = [];
    for (let back = 90; back >= 0; back -= 4) {
      fresh.push(
        tx({
          ...GROCERIES,
          accountId: CHECKING.id,
          date: addDays(AS_OF, -back),
          amountCents: 4_000,
        }),
      );
    }
    const lines = checkup(input({ accounts: [CHECKING], transactions: fresh }));
    expect(trials(lines)?.line).toBe("None in 60 days");
  });
});
