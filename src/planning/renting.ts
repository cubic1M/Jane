import {
  LOCAL_RENT,
  RENT_CATEGORY,
  RENT_MIN_PAYMENTS,
  RENT_NAME,
  RENT_NAME_NOT,
  depositRule,
} from "@/config/renting";

// Renting, counted (spec step 248), pure: rent found in payments, a rise set beside what is
// usual, and when a security deposit is due back.

export type RentTx = { date: string; amountCents: number; description: string; pfc: string | null };
export type RentPayment = { date: string; cents: number };

export const isRent = (t: RentTx) =>
  t.pfc === RENT_CATEGORY && RENT_NAME.test(t.description) && !RENT_NAME_NOT.test(t.description);

// Rent payments, oldest first (bank amounts are positive for money out).
export function rentPayments(txs: readonly RentTx[]): RentPayment[] {
  return txs
    .filter((t) => isRent(t) && t.amountCents > 0)
    .map((t) => ({ date: t.date, cents: t.amountCents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type RentRise = {
  beforeCents: number;
  nowCents: number;
  risePercentBps: number;
  yearlyExtraCents: number;
  usualBps: number;
  // Above what is usual by enough to ask about.
  askAbout: boolean;
};

// The latest rent against the one before it changed: the most common earlier amount.
export function rentRise(payments: readonly RentPayment[]): RentRise | null {
  if (payments.length < 2) return null;
  const nowCents = payments[payments.length - 1].cents;
  const earlier = payments.slice(0, -1).map((p) => p.cents);
  const counts = new Map<number, number>();
  for (const c of earlier) counts.set(c, (counts.get(c) ?? 0) + 1);
  const beforeCents = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  if (nowCents <= beforeCents) return null;
  const risePercentBps = Math.round(((nowCents - beforeCents) / beforeCents) * 10_000);
  return {
    beforeCents,
    nowCents,
    risePercentBps,
    yearlyExtraCents: (nowCents - beforeCents) * 12,
    usualBps: LOCAL_RENT.usualYearlyRiseBps,
    askAbout: risePercentBps >= LOCAL_RENT.askAboveBps,
  };
}

export const enoughRent = (payments: readonly RentPayment[]) =>
  payments.length >= RENT_MIN_PAYMENTS;

export type DepositStatus = "waiting_for_move_out" | "due" | "overdue" | "returned";
export type DepositView = {
  dueOn: string | null;
  daysLeft: number | null;
  status: DepositStatus;
  rule: ReturnType<typeof depositRule>;
};

const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function depositView(
  d: { state: string; movedOutOn: string | null; returnedOn: string | null },
  today: string,
): DepositView {
  const rule = depositRule(d.state);
  if (d.returnedOn) return { dueOn: null, daysLeft: null, status: "returned", rule };
  if (!d.movedOutOn) return { dueOn: null, daysLeft: null, status: "waiting_for_move_out", rule };
  const dueOn = addDays(d.movedOutOn, rule.days);
  const daysLeft = Math.round(
    (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
  return { dueOn, daysLeft, status: daysLeft < 0 ? "overdue" : "due", rule };
}
