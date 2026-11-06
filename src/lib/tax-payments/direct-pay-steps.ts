import { DIRECT_PAY, IRS_DIRECT_PAY_URL } from "@/config/tax";
import { formatCents } from "@/lib/money";

// "Jane prepares, you pay" for an estimated tax payment (connectors roadmap round 16,
// irs_direct_pay_steps): the values to type into IRS Direct Pay, which has no deep link or
// prefill, so Jane shows them and links to its start page. Moves no money, signs in nowhere. The
// person pastes the confirmation number back, since Direct Pay can't show it again. Pure.

export type DirectPaySteps = {
  url: string;
  // The tax year being paid for: a January payment is for the year before.
  taxYear: number;
  // YYYY-MM-DD the money leaves: the due date, or today when that has passed.
  payOn: string;
  late: boolean;
  steps: { label: string; value: string }[];
};

const DAY = 86_400_000;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

// The tax year an estimated payment due on `dueOn` (YYYY-MM-DD) counts toward.
export function estimatedTaxYear(dueOn: string): number {
  const [year, month] = dueOn.split("-").map(Number);
  return month === 1 ? year! - 1 : year!;
}

export function directPaySteps(input: {
  dueOn: string;
  cents: number;
  today: string;
}): DirectPaySteps {
  const { dueOn, cents, today } = input;
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new Error("A payment needs a positive amount");
  const late = dueOn < today;
  const payOn = late ? today : dueOn;
  if (days(today, payOn) > DIRECT_PAY.maxDaysAhead) {
    throw new Error(`Direct Pay takes a date at most ${DIRECT_PAY.maxDaysAhead} days ahead`);
  }
  const taxYear = estimatedTaxYear(dueOn);
  return {
    url: IRS_DIRECT_PAY_URL,
    taxYear,
    payOn,
    late,
    steps: [
      { label: "Reason for payment", value: "Estimated Tax" },
      { label: "Apply payment to", value: "1040ES" },
      { label: "Tax period for payment", value: String(taxYear) },
      {
        label: "Verify it's you",
        value: `With a return you've already filed, from a year before ${taxYear}`,
      },
      { label: "Payment amount", value: formatCents(cents) },
      { label: "Payment date", value: payOn },
      {
        label: "Confirmation number",
        value: "Copy it and paste it here: Direct Pay can't show it again.",
      },
      {
        label: "Changing it",
        value: `You can change or cancel it up to ${DIRECT_PAY.cancelBusinessDays} business days before the date. Direct Pay takes at most ${DIRECT_PAY.maxPerDay} payments in a day.`,
      },
    ],
  };
}
