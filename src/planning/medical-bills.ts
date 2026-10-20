import {
  ASSISTANCE_MIN_CENTS,
  MEDICAL_RULES,
  PLAN_MAX_MONTHS,
  PLAN_MIN_BILL_CENTS,
  PLAN_MIN_PAYMENT_CENTS,
} from "@/config/medical-bills";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";

// Medical bills (spec step 180). Pure: the requests Jane prepares for a bill, each a letter
// citing the right rule, and a payment plan's months and amount. Amounts always come from
// the bill itself.

export type MedicalBillInput = {
  key: string;
  provider: string;
  amountCents: number;
  // YYYY-MM-DD.
  billedOn: string;
};

export type MedicalKind = "itemized" | "insurance" | "assistance" | "plan";

export type MedicalItem = {
  id: string;
  kind: MedicalKind;
  bill: MedicalBillInput;
  label: string;
  body: string;
};

// A payment plan at no interest: the fewest months (up to PLAN_MAX_MONTHS) that keeps each
// payment at or above the minimum.
export function planTerms(amountCents: number): { months: number; paymentCents: number } {
  const months = Math.max(
    1,
    Math.min(PLAN_MAX_MONTHS, Math.floor(amountCents / PLAN_MIN_PAYMENT_CENTS)),
  );
  return { months, paymentCents: Math.ceil(amountCents / months) };
}

const head = (b: MedicalBillInput) =>
  `Hello, I'm writing about my account with ${b.provider}: a charge of ${formatCents(b.amountCents)} on ${dayLabel(b.billedOn, { year: true })}.`;

// What Jane would send about one bill. `hasInsurance` is whether the person has an active
// health plan on file.
export function medicalItems(bill: MedicalBillInput, hasInsurance: boolean): MedicalItem[] {
  const out: MedicalItem[] = [
    {
      id: `itemized:${bill.key}`,
      kind: "itemized",
      bill,
      label: `Ask ${bill.provider} for an itemized bill`,
      body: `${head(bill)} Please send me an itemized bill that lists each charge with its billing code, and the date of each service. ${MEDICAL_RULES.itemized} I'd like to check it before I pay anything more. Thank you.`,
    },
  ];
  if (hasInsurance) {
    out.push({
      id: `insurance:${bill.key}`,
      kind: "insurance",
      bill,
      label: `Ask ${bill.provider} to check this against my insurance`,
      body: `${head(bill)} I have health insurance on file. Please confirm this was billed to my plan and send me the amount my insurer says I owe. ${MEDICAL_RULES.insurance} If it wasn't billed to my insurer, please do that first. Thank you.`,
    });
  }
  if (bill.amountCents >= ASSISTANCE_MIN_CENTS) {
    out.push({
      id: `assistance:${bill.key}`,
      kind: "assistance",
      bill,
      label: `Apply to ${bill.provider} for financial assistance`,
      body: `${head(bill)} I'd like to apply for financial assistance (charity care) on this bill. ${MEDICAL_RULES.assistance} Please send me your application and your assistance policy, and hold this account from collections while it's reviewed. Thank you.`,
    });
  }
  if (bill.amountCents >= PLAN_MIN_BILL_CENTS) {
    const plan = planTerms(bill.amountCents);
    out.push({
      id: `plan:${bill.key}`,
      kind: "plan",
      bill,
      label: `Ask ${bill.provider} for a ${plan.months}-month plan with no interest`,
      body: `${head(bill)} I'd like to pay it off in ${plan.months} equal monthly payments of ${formatCents(plan.paymentCents)} with no interest or fees. ${MEDICAL_RULES.plan} Please confirm the plan in writing. Thank you.`,
    });
  }
  return out;
}
