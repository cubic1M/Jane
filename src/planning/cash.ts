import {
  CASH_HOMES,
  CASH_MIN_MOVE_CENTS,
  CHECKING_BUFFER_MONTHS,
  CURRENT_CASH_RATE_BPS,
  EMERGENCY_MAX_REACH_DAYS,
  type CashHome,
  type CashPlaceKind,
} from "@/config/cash";

// Cash done right (spec step 162, demo advice). Pure. Every dollar of cash gets a job: a
// month of spending stays in checking, the emergency fund sits where it earns well and can
// be reached in days, and only what's left can go somewhere that pays a little more for
// being harder to reach. The emergency fund is never put in a home it can't be reached
// from in EMERGENCY_MAX_REACH_DAYS.

export type CashPlace = {
  id: string;
  name: string;
  kind: CashPlaceKind;
  balanceCents: number;
  rateBps: number;
};

export type CashBucket = {
  key: "buffer" | "emergency" | "longer_term";
  label: string;
  cents: number;
  home: CashHome | null;
  rateBps: number;
};

export type CashMove = {
  key: "checking_to_savings" | "sweep_to_money_market";
  fromId: string;
  fromName: string;
  toId: string | null;
  toName: string;
  cents: number;
  // A year, at the stand-in rates.
  gainCents: number;
};

export type CashPlan = {
  totalCents: number;
  buckets: CashBucket[];
  nowYearlyCents: number;
  afterYearlyCents: number;
  gainCents: number;
  moves: CashMove[];
  // The longer-term cash in three rungs, if it went in a Treasury ladder instead.
  ladder: { months: number; cents: number }[];
};

const yearly = (cents: number, bps: number) => Math.round((cents * bps) / 10_000);
const home = (key: CashHome["key"]) => CASH_HOMES.find((h) => h.key === key)!;

// Only homes the emergency fund can be reached from in days.
export const canHoldEmergency = (h: CashHome) => h.reachDays <= EMERGENCY_MAX_REACH_DAYS;

// The emergency fund's home: in reach within days, and insured, the best rate of those.
export function emergencyHome(): CashHome {
  return CASH_HOMES.filter((h) => canHoldEmergency(h) && h.insured).sort(
    (a, b) => b.rateBps - a.rateBps,
  )[0];
}

export function cashPlan(input: {
  places: CashPlace[];
  monthlySpendingCents: number;
  emergencyTargetCents: number;
}): CashPlan {
  const total = input.places.reduce((s, p) => s + Math.max(0, p.balanceCents), 0);
  const buffer = Math.min(total, Math.round(input.monthlySpendingCents * CHECKING_BUFFER_MONTHS));
  const emergency = Math.min(Math.max(0, total - buffer), input.emergencyTargetCents);
  const rest = Math.max(0, total - buffer - emergency);
  // The emergency fund's home: the best that can be reached in days. Longer-term cash: a
  // money market fund (it can be reached in a day too); the ladder is shown beside it.
  const safe = emergencyHome();
  const longer = home("money_market");
  const buckets: CashBucket[] = [
    {
      key: "buffer",
      label: "A month of spending, in checking",
      cents: buffer,
      home: null,
      rateBps: CURRENT_CASH_RATE_BPS.checking,
    },
    {
      key: "emergency",
      label: "Emergency fund",
      cents: emergency,
      home: safe,
      rateBps: safe.rateBps,
    },
    {
      key: "longer_term",
      label: "Cash beyond the emergency fund",
      cents: rest,
      home: longer,
      rateBps: longer.rateBps,
    },
  ];
  const nowYearly = input.places.reduce(
    (s, p) => s + yearly(Math.max(0, p.balanceCents), p.rateBps),
    0,
  );
  const afterYearly = buckets.reduce((s, b) => s + yearly(b.cents, b.rateBps), 0);

  // The taps Jane can do through the stand-ins: checking above its buffer into savings
  // (still in reach in a day), and brokerage cash into the money market fund.
  const moves: CashMove[] = [];
  const checking = input.places.filter((p) => p.kind === "checking");
  const savings = input.places
    .filter((p) => p.kind === "savings")
    .sort((a, b) => b.rateBps - a.rateBps || b.balanceCents - a.balanceCents)[0];
  const checkingCents = checking.reduce((s, p) => s + Math.max(0, p.balanceCents), 0);
  const extra = checkingCents - buffer;
  const from = checking.sort((a, b) => b.balanceCents - a.balanceCents)[0];
  if (savings && from && extra >= CASH_MIN_MOVE_CENTS) {
    const cents = Math.min(extra, from.balanceCents);
    moves.push({
      key: "checking_to_savings",
      fromId: from.id,
      fromName: from.name,
      toId: savings.id,
      toName: savings.name,
      cents,
      gainCents: yearly(cents, savings.rateBps - from.rateBps),
    });
  }
  for (const sweep of input.places.filter((p) => p.kind === "sweep")) {
    if (sweep.balanceCents < CASH_MIN_MOVE_CENTS) continue;
    moves.push({
      key: "sweep_to_money_market",
      fromId: sweep.id,
      fromName: sweep.name,
      toId: sweep.id,
      toName: longer.name,
      cents: sweep.balanceCents,
      gainCents: yearly(sweep.balanceCents, longer.rateBps - sweep.rateBps),
    });
  }
  const third = Math.floor(rest / 3);
  return {
    totalCents: total,
    buckets,
    nowYearlyCents: nowYearly,
    afterYearlyCents: afterYearly,
    gainCents: afterYearly - nowYearly,
    moves,
    ladder:
      rest > 0
        ? [
            { months: 3, cents: third },
            { months: 6, cents: third },
            { months: 12, cents: rest - 2 * third },
          ]
        : [],
  };
}
