import {
  BILL_TERMS,
  IBOND_PENALTY_BEFORE_MONTHS,
  IBOND_PENALTY_MONTHS,
  MAX_RUNGS,
  PRODUCTS,
  type Product,
} from "@/config/short-term";

// Short-term money, placed safely (spec step 234, demo advice). Pure. For money needed in
// `months`: which products can hold it without locking it past the date, what each earns
// after federal and state tax (Treasury interest is free of state tax), and a ladder of
// Treasury bills that matures when the money is needed and rolls itself over until then.

const ZERO_STATE = 0;

export type Option = {
  product: Product;
  // After tax, as a yearly rate in basis points, with any early-redemption cost spread over
  // the time the money is held.
  afterTaxBps: number;
  yearlyCents: number;
};

// Products that never lock the money past the date: their lock must fit inside the time left.
export const eligible = (months: number): Product[] =>
  PRODUCTS.filter((p) => p.lockMonths <= months);

export function afterTaxBps(p: Product, months: number, fed: number, state: number): number {
  const taxRate = fed + (p.stateTaxed ? state : ZERO_STATE);
  let gross = p.rateBps;
  // An I bond cashed before five years forgoes its last three months of interest.
  if (p.key === "ibond" && months < IBOND_PENALTY_BEFORE_MONTHS && months > IBOND_PENALTY_MONTHS) {
    gross = (p.rateBps * (months - IBOND_PENALTY_MONTHS)) / months;
  }
  return Math.round(gross * (1 - taxRate));
}

export function compare(input: {
  amountCents: number;
  months: number;
  fed: number;
  state: number;
}): Option[] {
  return eligible(input.months)
    .map((product) => {
      const bps = afterTaxBps(product, input.months, input.fed, input.state);
      return {
        product,
        afterTaxBps: bps,
        yearlyCents: Math.round((input.amountCents * bps) / 10_000),
      };
    })
    .sort((a, b) => b.afterTaxBps - a.afterTaxBps || a.product.lockMonths - b.product.lockMonths);
}

export type Bill = { term: number; startMonth: number; endMonth: number; rateBps: number };
export type Rung = { amountCents: number; bills: Bill[] };

const BILL_RATE: Record<number, number> = Object.fromEntries(
  PRODUCTS.filter((p) => p.key.startsWith("tbill_")).map((p) => [p.lockMonths, p.rateBps]),
);

// Bills one after another from `startMonth`, each the longest term that still ends by the
// goal date: they never run past it. Months left over (under the shortest term) stay in
// savings.
function billsFor(startMonth: number, months: number): Bill[] {
  const bills: Bill[] = [];
  let at = startMonth;
  for (;;) {
    const term = BILL_TERMS.find((t) => at + t <= months);
    if (!term) break;
    bills.push({ term, startMonth: at, endMonth: at + term, rateBps: BILL_RATE[term] });
    at += term;
  }
  return bills;
}

// A ladder for money needed in `months`: up to MAX_RUNGS equal rungs whose first bills end
// at spread-out months, each rolling into further bills that end by the goal date.
export function ladder(amountCents: number, months: number): Rung[] {
  const shortest = BILL_TERMS[BILL_TERMS.length - 1];
  const n = Math.max(1, Math.min(MAX_RUNGS, Math.floor(months / shortest)));
  const each = Math.floor(amountCents / n);
  const rungs: Rung[] = [];
  for (let i = 1; i <= n; i += 1) {
    const amount = i === n ? amountCents - each * (n - 1) : each;
    // The first bill's term: the longest that fits in this rung's share of the time.
    const share = Math.max(shortest, Math.round((months * i) / n));
    const first = BILL_TERMS.find((t) => t <= share && t <= months) ?? shortest;
    const bills =
      first <= months
        ? [{ term: first, startMonth: 0, endMonth: first, rateBps: BILL_RATE[first] }]
        : [];
    const rest = billsFor(bills.at(-1)?.endMonth ?? 0, months);
    rungs.push({ amountCents: amount, bills: [...bills, ...rest] });
  }
  return rungs;
}

// Nothing may mature after the goal date.
export const neverPastGoal = (rungs: Rung[], months: number) =>
  rungs.every((r) => r.bills.every((b) => b.endMonth <= months));

export const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.max(
    0,
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
      b.getUTCMonth() -
      a.getUTCMonth() -
      (b.getUTCDate() < a.getUTCDate() ? 1 : 0),
  );
};

export const addMonths = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
