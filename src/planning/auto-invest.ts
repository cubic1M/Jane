import {
  LEFTOVER_SHARE,
  MAX_CONTRIBUTION_CENTS,
  MIN_CONTRIBUTION_CENTS,
  SAFE_TO_SPEND_FLOOR_CENTS,
  SUGGESTED_PAYCHECK_SHARE,
  SUGGESTED_ROUND_CENTS,
} from "@/config/auto-invest";
import { CORE_FUNDS } from "@/config/funds";
import { TARGET_MIXES, type RiskLevel } from "@/config/investing";

// Automatic investing (spec step 134): how much goes in on a payday, if anything. Pure.
// Safe to spend comes first: Jane never invests money it needs, and pauses the payday
// instead when it's low.

export type AutoInvestMode = "fixed" | "leftover";

export type Contribution =
  { status: "invested"; amountCents: number } | { status: "paused"; reason: string };

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function decideContribution({
  mode,
  amountCents,
  safeCents,
}: {
  mode: AutoInvestMode;
  amountCents: number | null;
  // Null when there's no checking account to work it out from.
  safeCents: number | null;
}): Contribution {
  if (safeCents === null) {
    return {
      status: "paused",
      reason: "I can't see your checking account, so I can't tell what's safe.",
    };
  }
  const room = safeCents - SAFE_TO_SPEND_FLOOR_CENTS;
  const wanted =
    mode === "fixed"
      ? (amountCents ?? 0)
      : Math.min(MAX_CONTRIBUTION_CENTS, Math.floor(Math.max(0, room) * LEFTOVER_SHARE));
  const amount = Math.min(wanted, Math.max(0, room));
  if (amount < MIN_CONTRIBUTION_CENTS) {
    return {
      status: "paused",
      reason: `Safe to spend is ${dollars(safeCents)}, and I keep at least ${dollars(SAFE_TO_SPEND_FLOOR_CENTS)} of it for you.`,
    };
  }
  return { status: "invested", amountCents: amount };
}

// What Jane suggests starting with: a round share of the paycheck.
export function suggestedAmount(paycheckCents: number): number {
  const raw = Math.floor(paycheckCents * SUGGESTED_PAYCHECK_SHARE);
  return Math.max(SUGGESTED_ROUND_CENTS, raw - (raw % SUGGESTED_ROUND_CENTS));
}

// The buys a contribution becomes: the low-cost core funds in the risk level's mix (cash
// is left as cash), to the cent.
export function contributionBuys(
  amountCents: number,
  riskLevel: RiskLevel,
  // Spec step 236: the funds bought for each kind (screened when the person listed values).
  funds: Readonly<Record<"us_stocks" | "intl_stocks" | "bonds" | "cash", string>> = CORE_FUNDS,
): { ticker: string; amountCents: number }[] {
  const mix = TARGET_MIXES[riskLevel];
  const parts = (["us_stocks", "intl_stocks", "bonds"] as const).filter((c) => mix[c] > 0);
  const invested = parts.reduce((s, c) => s + mix[c], 0);
  let left = amountCents;
  return parts.map((c, i) => {
    const amount = i === parts.length - 1 ? left : Math.round((amountCents * mix[c]) / invested);
    left -= amount;
    return { ticker: funds[c], amountCents: amount };
  });
}
