import { DROP_THRESHOLDS, PAUSE_YEARS } from "@/config/steady-hand";
import { RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";

// A steady hand (spec step 163, demo advice). Pure. Spots a big drop in the investments'
// own return, and works out what a sell would give up, as a range and as past-tense math:
// never a statement about what markets will do.

export type DropPeriod = { key: string; label: string; timeWeighted: number | null };
export type Drop = { key: string; windowLabel: string; rate: number };

export function detectDrop(periods: DropPeriod[]): Drop | null {
  const found = DROP_THRESHOLDS.flatMap((t) => {
    const p = periods.find((x) => x.key === t.key);
    return p && p.timeWeighted !== null && p.timeWeighted <= t.below
      ? [{ key: t.key, windowLabel: t.label, rate: p.timeWeighted }]
      : [];
  });
  // The worst of them.
  return found.sort((a, b) => a.rate - b.rate)[0] ?? null;
}

// What `sellCents` would have grown by over `years` at the assumed range, if left invested.
// An assumption range, like every projection in Jane, not a promise.
export function givenUp(sellCents: number, years = PAUSE_YEARS) {
  const grow = (r: number) => Math.round(sellCents * ((1 + r) ** years - 1));
  return { lowCents: grow(RETURN_LOW.value), highCents: grow(RETURN_HIGH.value), years };
}
