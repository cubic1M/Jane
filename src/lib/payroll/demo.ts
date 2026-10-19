import { DEMO_PAY_STUB } from "@/config/tax";
import type { PayDeposit, PayStub, PayrollSource } from "./types";

// The demo bank's payroll stand-in (spec step 120): each paycheck it deposits gets the same
// made-up stub (src/config/tax.ts DEMO_PAY_STUB), scaled to the deposit, so the estimate and
// the withholding checkup have gross pay and withholding to work from. Pure.

const scale = (cents: number, by: number) => Math.round(cents * by);

export const demoPayroll: PayrollSource = {
  kind: "demo",
  payStubs(deposits: PayDeposit[]): PayStub[] {
    return deposits.map((d) => {
      const by = d.amountCents / DEMO_PAY_STUB.netCents;
      return {
        payDate: d.date,
        employer: d.payer,
        grossCents: scale(DEMO_PAY_STUB.grossCents, by),
        retirementCents: scale(DEMO_PAY_STUB.retirementCents, by),
        otherPretaxCents: scale(DEMO_PAY_STUB.otherPretaxCents, by),
        federalWithheldCents: scale(DEMO_PAY_STUB.federalWithheldCents, by),
        stateWithheldCents: scale(DEMO_PAY_STUB.stateWithheldCents, by),
        netCents: d.amountCents,
      };
    });
  },
};
