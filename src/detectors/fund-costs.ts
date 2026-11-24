import { DETECTOR_RATES as R } from "@/config/detectors";
import { DEMO_EMPLOYER_PLAN_MENU, FUND_FACTS, LOWER_COST_EQUIVALENTS } from "@/config/funds";
import type { ProfileHolding, ProfileInput } from "@/profile/build";

// What a held fund costs against a similar one, read the same by the fee card (investment_fees,
// ./holdings.ts) and the 401(k) menu card (plan_menu, ./planning.ts). One fund is one card (the
// manager, 11-19, as one fee and one missing cover are: #2090, #2094): where the fee card names a
// 401(k) fund, what the plan's menu adds goes into its detail, and plan_menu is left for the funds
// no fee card names.

type Data = Pick<ProfileInput, "accounts" | "holdings">;
type FeeRow = {
  h: ProfileHolding;
  cheaper: { ticker: string; bps: number };
  saving: number;
};
type MenuRow = { h: ProfileHolding; to: string; bps: number; saving: number };

const held = (list: readonly ProfileHolding[] | undefined) =>
  (list ?? []).filter((h) => !h.isCash && h.ticker && h.valueCents > 0);

// Each held fund with a cheaper fund of the same kind, and the yearly difference.
function feeRowsOf(data: Data): FeeRow[] {
  return held(data.holdings).flatMap((h) => {
    const facts = FUND_FACTS[h.ticker!];
    const cheaper = (LOWER_COST_EQUIVALENTS[h.ticker!] ?? [])
      .filter((t) => FUND_FACTS[t])
      .map((t) => ({ ticker: t, bps: FUND_FACTS[t].expenseRatioBps }))
      .sort((a, b) => a.bps - b.bps)[0];
    if (!facts || !cheaper || facts.expenseRatioBps <= cheaper.bps) return [];
    return [
      {
        h,
        cheaper,
        saving: Math.round((h.valueCents * (facts.expenseRatioBps - cheaper.bps)) / 10_000),
      },
    ];
  });
}

// The fee card's funds, when it's raised (its total is worth a card).
export function feeCardRows(data: Data): FeeRow[] {
  const rows = feeRowsOf(data);
  return rows.reduce((s, r) => s + r.saving, 0) >= R.feeMinCents ? rows : [];
}

// Each 401(k) fund whose plan's own menu has a cheaper fund of the same kind.
// The menu is the demo plan's (DEMO_EMPLOYER_PLAN_MENU): a real account's own plan menu isn't
// known, so with `advice === false` no menu claim is made (a fund it can't buy isn't offered).
export function menuRowsOf(data: Data, advice?: boolean): MenuRow[] {
  if (advice === false) return [];
  const plans = new Set(data.accounts.filter((a) => a.subtype === "401k").map((a) => a.id));
  return (data.holdings ?? []).flatMap((h) => {
    if (!plans.has(h.accountId) || !h.ticker || h.isCash || h.valueCents <= 0) return [];
    const bps = FUND_FACTS[h.ticker]?.expenseRatioBps;
    const cheaper = (LOWER_COST_EQUIVALENTS[h.ticker] ?? [])
      .filter((t) => DEMO_EMPLOYER_PLAN_MENU.includes(t))
      .map((t) => ({ t, bps: FUND_FACTS[t]?.expenseRatioBps }))
      .filter((c): c is { t: string; bps: number } => c.bps !== undefined)
      .sort((a, b) => a.bps - b.bps)[0];
    if (bps === undefined || !cheaper || cheaper.bps >= bps) return [];
    return [
      {
        h,
        to: cheaper.t,
        bps: cheaper.bps,
        saving: Math.round((h.valueCents * (bps - cheaper.bps)) / 10_000),
      },
    ];
  });
}

// The same holding, whichever card reads it.
export const sameHolding = (a: ProfileHolding, b: ProfileHolding) =>
  a.accountId === b.accountId && a.ticker === b.ticker;
