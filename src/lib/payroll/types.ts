// Pay stubs (spec step 120): what each paycheck was before tax and what came out of it,
// from a payroll connection. There's no payroll partner yet, so the demo bank's paychecks
// get a stand-in stub (./demo.ts); everyone else can type in the year-to-date figures from
// their latest pay stub (src/lib/tax-profile.ts). Swap in Plaid Income's payroll data (or
// a payroll provider such as Argyle or Pinwheel) behind PayrollSource.

export type PayStub = {
  payDate: string;
  employer: string;
  grossCents: number;
  // Pre-tax 401(k) and similar: out of federal wages, not out of Social Security wages.
  retirementCents: number;
  // Pre-tax health, HSA and FSA: out of both.
  otherPretaxCents: number;
  federalWithheldCents: number;
  stateWithheldCents: number;
  netCents: number;
};

export type PayDeposit = { date: string; amountCents: number; payer: string };

export interface PayrollSource {
  readonly kind: "demo" | "connected";
  // The stubs for a person's paychecks, from the deposits Jane sees.
  payStubs(deposits: PayDeposit[]): PayStub[];
}
