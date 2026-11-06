import {
  NO_STATE_INCOME_TAX,
  STATE_ESTIMATED_TAX,
  type StateEstimatedTax,
} from "@/config/state-estimated-tax";
import { ESTIMATED_TAX_DATES } from "@/config/tax-pack";

// A state's estimated tax for a year, split the state's way over the federal dates
// (src/config/state-estimated-tax.ts): what's due when, and where the person pays it. A date with
// nothing due (California's September) isn't listed. The cents always add up to the year's. Pure.

type StatePayment = { due: string; cents: number; percent: number };

type StateEstimated =
  | { state: string; payments: StatePayment[]; where: StateEstimatedTax }
  | { state: string; none: "no_income_tax" | "not_listed" };

const pad = (n: number) => String(n).padStart(2, "0");

export function stateEstimated(state: string, yearCents: number, taxYear: number): StateEstimated {
  const code = state.trim().toUpperCase();
  if (NO_STATE_INCOME_TAX.includes(code)) return { state: code, none: "no_income_tax" };
  const where = STATE_ESTIMATED_TAX[code];
  if (!where) return { state: code, none: "not_listed" };
  const due = ESTIMATED_TAX_DATES.map(
    (d) => `${taxYear + (d.nextYear ? 1 : 0)}-${pad(d.month)}-${pad(d.day)}`,
  );
  const payments: StatePayment[] = [];
  let left = Math.max(0, Math.round(yearCents));
  where.shares.forEach((percent, i) => {
    if (percent === 0) return;
    const last = where.shares.slice(i + 1).every((p) => p === 0);
    const cents = last ? left : Math.round((yearCents * percent) / 100);
    left -= cents;
    payments.push({ due: due[i]!, cents, percent });
  });
  return { state: code, payments, where };
}
