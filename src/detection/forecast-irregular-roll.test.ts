import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, input, tx } from "./__fixtures__/build";
import { forecastAccounts } from "./forecast";
import { addDays } from "./units";

// CodeRabbit 1c detn-01 #4: a balance dated before an irregular bill's due date walked forward
// without that bill, so "today" was too high by the bill's amount.
const TAX = {
  description: "MULTNOMAH COUNTY PROPERTY TAX",
  merchantName: "Multnomah County Property Tax",
  pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
  pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
  amountCents: 221_050,
};

describe("rolling a balance forward past an irregular bill", () => {
  // Tax paid twice a year, next due 12 days after AS_OF; today is 15 days after AS_OF.
  const today = addDays(AS_OF, 15);
  const transactions = [
    tx({ ...TAX, date: addDays(AS_OF, -353) }),
    tx({ ...TAX, date: addDays(AS_OF, -170) }),
  ];
  const account = {
    ...CHECKING,
    currentBalanceCents: 1_000_000,
    balanceAsOf: addDays(AS_OF, 8),
  };

  it("takes the bill due between the balance's day and today off today's balance", () => {
    const [f] = forecastAccounts(input({ asOf: today, transactions, accounts: [account] }), 31);
    expect(f.startOn).toBe(account.balanceAsOf);
    expect(f.todayCents).toBe(1_000_000 - 221_050);
  });
});
