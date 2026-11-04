import { PRICE_INCREASE_THRESHOLD } from "./price-increase";

// --- Watching once money is in good shape ---------------------------------------------------------

// An insurance premium that rose at renewal (src/insights/changes.ts): a policy paid every six
// months or once a year, whose latest charge is at least this share and this much above the
// one before, a term earlier (between these many days; a charge in between means it's paid
// monthly, which the bill-change rule already watches).
export const PREMIUM_RENEWAL_MIN_GAP_DAYS = 150;
export const PREMIUM_RENEWAL_MAX_GAP_DAYS = 400;
export const PREMIUM_RENEWAL_MIN_SHARE = PRICE_INCREASE_THRESHOLD;
export const PREMIUM_RENEWAL_MIN_CENTS = 1_000;
// A trial's end date is a guess from its first charge (TRIAL_LENGTH_DAYS), so its heads-up is
// never surer than this.
export const TRIAL_DEADLINE_MAX_PERCENT = 60;
// Alerts that come from Jane's own records rather than a run of charges, and how sure each is:
// spending against a budget the person set (a charge can be filed in the wrong category), a
// refund our team's record says is due (it can arrive under another name), and a date by where
// it came from (one the person typed in is theirs; one from charges is an estimate).
export const OVER_BUDGET_CONFIDENCE = {
  percent: 90,
  reason:
    "your spending by category against the budget you set; a charge can be in the wrong category",
} as const;
export const MISSING_REFUND_CONFIDENCE = {
  percent: 85,
  reason: "our team's record and your transactions since; a refund can come under another name",
} as const;
export const DEADLINE_SOURCE_CONFIDENCE: Readonly<
  Record<
    "transactions" | "loans" | "entered" | "documents" | "insurance",
    { percent: number; reason: string }
  >
> = {
  entered: { percent: 100, reason: "the date you added" },
  loans: { percent: 95, reason: "the due date your lender reports" },
  documents: { percent: 90, reason: "the date read from your document" },
  insurance: { percent: 90, reason: "the date on your policy" },
  transactions: { percent: 70, reason: "estimated from your charges" },
};
