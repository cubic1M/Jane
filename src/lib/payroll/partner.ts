import { randomUUID } from "node:crypto";

// The payroll partner (spec step 210): where Jane sends a change to a person's retirement
// contribution at work. An interface, so a payroll partner can be connected later; until
// then the stand-in records the request and moves nothing: the change takes effect when
// the person's employer makes it. Pay never changes without the person's tap.

export const PAYROLL_STAND_IN = "stand-in";

export interface PayrollPartner {
  readonly name: string;
  readonly simulated: boolean;
  requestContributionChange(request: {
    fromRate: number;
    toRate: number;
    // YYYY-MM-DD: from the first paycheck after this.
    effectiveOn: string;
  }): Promise<{ partnerRef: string }>;
  // Spec step 232: how the plan balance and future contributions are invested.
  requestAllocationChange(allocation: AllocationChange): Promise<{ partnerRef: string }>;
}

export type AllocationChange = { ticker: string; share: number }[];

export const standInPayroll: PayrollPartner = {
  name: PAYROLL_STAND_IN,
  simulated: true,
  async requestContributionChange() {
    return { partnerRef: `SIMPAY-${randomUUID().slice(0, 8).toUpperCase()}` };
  },
  async requestAllocationChange() {
    return { partnerRef: `SIMFUND-${randomUUID().slice(0, 8).toUpperCase()}` };
  },
};

export const payrollPartner = (): PayrollPartner => standInPayroll;
