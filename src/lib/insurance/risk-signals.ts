import {
  RISK_KINDS,
  type PolicyKind,
  RISK_LOOKBACK_DAYS,
  RISK_NEW_PET_QUIET_DAYS,
  RISK_SIGNALS,
  type RiskKind,
} from "@/config/insurance";

// Risks seen in how the person lives (spec step 197): signals in their transactions, each
// a rule. Plaid's sign: money in is negative. Pure.

export type SignalTransaction = {
  id: string;
  // YYYY-MM-DD.
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
};

export type Signal = {
  kind: RiskKind;
  // The newest transaction that showed it.
  merchant: string;
  amountCents: number;
  date: string;
  transactionId: string;
};

const DAY = 86_400_000;
const daysBefore = (asOf: string, days: number) =>
  new Date(Date.parse(`${asOf}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);

const textOf = (t: SignalTransaction) => `${t.merchantName ?? ""} ${t.description}`;
const nameOf = (t: SignalTransaction) => (t.merchantName ?? t.description).trim();

// The signals in these transactions as of asOf: for each kind, the newest transaction of the
// right direction and size in the lookback window. A new dog also needs the person to have
// had no vet or pet-store charge for a good while before (an old pet isn't a new dog), and
// no pet on the household already.
export function detectSignals(
  transactions: SignalTransaction[],
  asOf: string,
  { knownPets = 0 }: { knownPets?: number } = {},
): Signal[] {
  const since = daysBefore(asOf, RISK_LOOKBACK_DAYS);
  const signals: Signal[] = [];
  for (const kind of RISK_KINDS) {
    const rule = RISK_SIGNALS[kind];
    const matching = transactions
      .filter((t) => rule.pattern.test(textOf(t)))
      .filter((t) => (rule.direction === "in" ? t.amountCents < 0 : t.amountCents > 0))
      .filter((t) => Math.abs(t.amountCents) >= rule.minCents)
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const recent = matching.find((t) => t.date >= since && t.date <= asOf);
    if (!recent) continue;
    if (kind === "new_dog") {
      if (knownPets > 0) continue;
      const quietUntil = daysBefore(asOf, RISK_NEW_PET_QUIET_DAYS);
      if (matching.some((t) => t.date < since && t.date >= quietUntil)) continue;
    }
    signals.push({
      kind,
      merchant: nameOf(recent),
      amountCents: Math.abs(recent.amountCents),
      date: recent.date,
      transactionId: recent.id,
    });
  }
  return signals;
}

// The policy kind that closes each gap a risk can open, by the gap's key.
export const RISK_GAP_KINDS: Record<string, PolicyKind> = Object.fromEntries(
  Object.values(RISK_SIGNALS).flatMap((s) => (s.gap ? [[s.gap.key, s.gap.kind]] : [])),
);
