import {
  RENT_TRANSFER_AMOUNT_TOLERANCE,
  RENT_TRANSFER_FROM_DAY,
  RENT_TRANSFER_MIN_CENTS,
  RENT_TRANSFER_MIN_MONTHS,
  RENT_TRANSFER_TO_DAY,
  RENT_TRANSFER_WORDS,
} from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { inLookback } from "./helpers";
import type { DetectionInput, DetectionTransaction } from "./types";
import { addDays, dayOfMonth, firstOfMonth, median } from "./units";

// Rent sent to a person by Zelle or Venmo, as a question rather than a guess (RENT_TRANSFER_*):
// about the same amount to one payee each month, near the start of the month, that the rules filed
// as a transfer. The person's answer becomes a rule for that payee (src/lib/rent-question.ts), so
// a payee they've answered is never asked about again. Pure.

export type RentTransfer = {
  // The payee as a merchant rule keys it (src/lib/categories.ts merchantRuleKey).
  merchantKey: string;
  name: string;
  amountCents: number;
  months: number;
  transactionIds: string[];
};

const P2P = new RegExp(`(?<![A-Z0-9])(?:${RENT_TRANSFER_WORDS.join("|")})(?![A-Z0-9])`);

// The month a payment is for: one sent late in the month before counts as the next month's (a
// date RENT_TRANSFER_TO_DAY + 1 days on is always in the next month from the 25th).
const rentMonth = (date: string) =>
  dayOfMonth(date) >= RENT_TRANSFER_FROM_DAY
    ? firstOfMonth(addDays(date, RENT_TRANSFER_TO_DAY + 1))
    : firstOfMonth(date);

const nearMonthStart = (date: string) =>
  dayOfMonth(date) >= RENT_TRANSFER_FROM_DAY || dayOfMonth(date) <= RENT_TRANSFER_TO_DAY;

// Rent sent (money out, a transfer) or, from rentReceived, rent collected (money in).
function steadyMonthly(
  input: DetectionInput,
  answered: ReadonlySet<string>,
  direction: "out" | "in",
): RentTransfer[] {
  const groups = new Map<string, DetectionTransaction[]>();
  for (const t of inLookback(input)) {
    const cents = direction === "out" ? t.amountCents : -t.amountCents;
    const primary = direction === "out" ? "TRANSFER_OUT" : "TRANSFER_IN";
    if (cents < RENT_TRANSFER_MIN_CENTS || t.pfcPrimary !== primary) continue;
    if (!P2P.test(t.description.toUpperCase()) || !nearMonthStart(t.date)) continue;
    const key = normalizeMerchant(t.description)?.key;
    if (!key || answered.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), { ...t, amountCents: cents }]);
  }
  const found: RentTransfer[] = [];
  for (const [merchantKey, rows] of groups) {
    const usual = median(rows.map((r) => r.amountCents));
    const steady = rows.filter(
      (r) => Math.abs(r.amountCents - usual) <= usual * RENT_TRANSFER_AMOUNT_TOLERANCE,
    );
    const months = new Set(steady.map((r) => rentMonth(r.date)));
    // One payment a month: two in a month is something else (splitting bills, paying back).
    if (months.size < RENT_TRANSFER_MIN_MONTHS || months.size !== steady.length) continue;
    const name = normalizeMerchant(rows[0].description)?.name ?? merchantKey;
    found.push({
      merchantKey,
      // Money in is keyed "from <payer>" (withoutPaymentApp): the question names the person.
      name: direction === "in" ? name.replace(/^From /, "") : name,
      amountCents: usual,
      months: months.size,
      transactionIds: steady.map((r) => r.id),
    });
  }
  return found.sort((a, b) => b.amountCents - a.amountCents);
}

export function rentTransfers(
  input: DetectionInput,
  answered: ReadonlySet<string> = new Set(),
): RentTransfer[] {
  return steadyMonthly(input, answered, "out");
}

// The other way (debugger 11-01): about the same amount from one person by Zelle or Venmo near the
// start of each month, filed as a transfer in. Rent from a tenant is income (Schedule E), but a
// roommate's share of the person's own rent looks the same, so Jane asks instead of guessing.
export function rentReceived(
  input: DetectionInput,
  answered: ReadonlySet<string> = new Set(),
): RentTransfer[] {
  return steadyMonthly(input, answered, "in");
}
