import { describe, expect, it } from "vitest";
import { bankFeesYear } from "@/planning/bank-fees";
import { AS_OF, CHECKING, input, tx } from "./__fixtures__/build";
import { feeAlerts } from "./alerts";
import { bankFees } from "./rules/bank-fees";
import { addDays } from "./units";

// Debugger 11-14: a demo-bank student's alerts said "$3.00 fee on Demo Checking: "EARNIN TIP" on
// Nov 12. Banks often take a fee back when asked." A tip to a pay advance app is the cost of the
// advance (costly borrowing, src/planning/costly-borrowing.ts), the bank never took it and can't
// give it back. Plaid may still file it under bank fees, as the demo bank does.

const tip = tx({
  accountId: CHECKING.id,
  date: addDays(AS_OF, -2),
  amountCents: 300,
  description: "EARNIN TIP",
  pfcPrimary: "BANK_FEES",
  pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
});
const overdraft = tx({
  accountId: CHECKING.id,
  date: addDays(AS_OF, -5),
  amountCents: 3_400,
  description: "OVERDRAFT FEE",
  pfcPrimary: "BANK_FEES",
  pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
});

describe("a pay advance app's tip filed as a bank fee", () => {
  it("isn't a fee alert promising it back; the overdraft fee still is", () => {
    const alerts = feeAlerts(input({ transactions: [tip, overdraft] }));
    expect(alerts.map((a) => a.key)).toEqual([overdraft.id]);
  });

  it("isn't in the bank fees found on the account", () => {
    const [finding] = bankFees(input({ transactions: [tip, overdraft] }), []);
    expect(finding?.evidence).toMatchObject({ totalCents: 3_400 });
  });

  it("isn't in the year of bank fees the suggestion counts", () => {
    const fees = bankFeesYear(
      [tip, overdraft].map((t) => ({ ...t, pfc: t.pfcDetailed })),
      12,
    );
    expect(fees?.count).toBe(1);
    expect(fees?.seenCents).toBe(3_400);
  });
});
