import type { PayFrequency } from "@/config/benefits";
import type { PrismaClient } from "@/generated/prisma/client";
import { demoPaystubs } from "@/data-sources/demo/demo-payroll";
import { demoOptionsAllowed } from "@/lib/compare";
import { db as defaultClient } from "@/lib/db";
import { hasDemoBank } from "@/lib/plaid/demo";

// Pay stubs (spec step 150): where the deductions for benefits through work come from. A
// bank only sees net pay, so this needs a payroll partner. Until one is connected (Plaid
// Income's payroll data, or the person uploading a pay stub), the stand-in answers for
// demo-bank people only, from src/data-sources/demo/demo-payroll.ts; everyone else gets the
// guided questions alone. To swap in a partner: implement PayrollSource over its API and
// return it from payrollFor when PAYROLL_PARTNER names it.

export type Paystub = {
  employer: string;
  // YYYY-MM-DD.
  payDate: string;
  payFrequency: PayFrequency;
  grossCents: number;
  netCents: number;
  deductions: { label: string; amountCents: number }[];
  // The employer's open enrollment for benefits, when the payroll knows it.
  openEnrollment: { start: string; end: string } | null;
};

export interface PayrollSource {
  readonly name: string;
  readonly demo: boolean;
  // Newest first.
  paystubs(userId: string, options: { now: Date }): Promise<Paystub[]>;
}

const demoPayroll: PayrollSource = {
  name: "demo",
  demo: true,
  paystubs: async (_userId, { now }) => demoPaystubs(now),
};

export async function payrollFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<PayrollSource | null> {
  const configured = process.env.PAYROLL_PARTNER ?? "demo";
  if (configured !== "demo" || !demoOptionsAllowed()) return null;
  return (await hasDemoBank(userId, { client })) ? demoPayroll : null;
}
