import {
  HEALTH_BANDS,
  HEALTH_CARDS_ZERO_MONTHS,
  HEALTH_CUSHION_FULL_MONTHS,
  HEALTH_MARGIN_FULL_RATE,
  HEALTH_MARGIN_ZERO_RATE,
  HEALTH_MIN_PARTS,
  HEALTH_MONTHS,
  HEALTH_POINTS_PER_SLIP,
  HEALTH_SLIP_DAYS,
  HEALTH_WEIGHTS,
  type HealthPart,
} from "@/config/health-score";
import type { OneOff } from "@/insights/typical-month";
import { formatCents } from "@/lib/money";
import { plural } from "@/lib/plural";

// Money health score (spec step 146). Pure: one number from 0 to 100 out of a few parts,
// each weighted in src/config/health-score.ts and explained in plain words, with the next
// step that would raise it. Parts with nothing to go on are left out and the score is
// scaled over the rest. It explains; it never judges.

export type HealthInput = {
  // Cash in checking and savings; null when no balances are known.
  cashCents: number | null;
  // Averages over the last few full months; null without enough history.
  monthlySpendingCents: number | null;
  monthlyIncomeCents: number | null;
  // Late, overdraft and insufficient-funds fees lately; null without transactions.
  slips: number | null;
  // Card balances carried; null when the person has no cards linked or a card's balance
  // isn't known (an uploaded statement).
  cardBalanceCents: number | null;
  cardsLinked?: boolean;
  goals: { onTrack: number; total: number };
  // One-off costs left out of the spending average (books QA), to say so.
  oneOffs?: OneOff[];
};

// What the person's cards carry: null with no cards, or when a card's balance isn't known (an
// uploaded statement carries none), never "no balance carried" (night QA 10-30: a card-only
// person scored 100 of 100 from it).
export function cardBalanceOf(cards: readonly { currentBalanceCents: number | null }[]) {
  if (cards.length === 0 || cards.some((c) => c.currentBalanceCents === null)) return null;
  return cards.reduce((s, c) => s + Math.max(0, c.currentBalanceCents ?? 0), 0);
}

// Whether spending can be seen at all: it happens in checking or on a card. A savings account
// alone shows money moved in and interest, so no margin can be worked out from it.
export function spendingOnFile(accounts: readonly { type: string; subtype: string | null }[]) {
  return accounts.some(
    (a) => a.type === "credit" || (a.type === "depository" && a.subtype === "checking"),
  );
}

export type HealthPartScore = {
  part: HealthPart;
  label: string;
  points: number;
  max: number;
  why: string;
  // What would raise it, when it isn't full.
  next: string | null;
};

export type HealthScore = {
  score: number;
  band: string;
  parts: HealthPartScore[];
  // Parts left out, and why.
  left: { part: HealthPart; label: string; why: string }[];
  // The points the counted parts add up to, out of their weights; the score is this scaled
  // to 100 when a part is left out.
  counted: { points: number; max: number };
};

export const HEALTH_LABELS: Record<HealthPart, string> = {
  cushion: "Cash cushion",
  margin: "Room each month",
  onTime: "Bills on time",
  cards: "Card balances",
  goals: "Savings goals",
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const one = (x: number) => (Math.round(x * 10) / 10).toString();
// Under a month of cover reads better in days ("about 0 months" explains nothing).
const cover = (months: number) => {
  if (months >= 1) return `about ${one(months)} ${months === 1 ? "month" : "months"}`;
  const days = Math.round(months * 30);
  return days < 1 ? "less than a day" : `about ${plural(days, "day")}`;
};

export const bandOf = (score: number) =>
  HEALTH_BANDS.find((b) => score >= b.min)?.label ?? HEALTH_BANDS.at(-1)!.label;

function part(key: HealthPart, share: number, why: string, next: string): HealthPartScore {
  const max = HEALTH_WEIGHTS[key];
  const points = Math.round(max * clamp(share));
  return {
    part: key,
    label: HEALTH_LABELS[key],
    points,
    max,
    why,
    next: points < max ? next : null,
  };
}

// The months the data covers from their first day (night QA 10-30: statements from Jul 28 made
// July a month of four days, which cut average spending by a third and scored a person whose
// cash covers two months 100 of 100, beside "Build a cushion for emergencies").
export function fullMonthsOnly<T extends { month: string }>(
  months: readonly T[],
  firstDay: string | null,
): T[] {
  return firstDay === null ? [] : months.filter((m) => `${m.month}-01` >= firstDay);
}

export function healthScore(input: HealthInput): HealthScore | null {
  const parts: HealthPartScore[] = [];
  const left: HealthScore["left"] = [];
  const skip = (key: HealthPart, why: string) =>
    left.push({ part: key, label: HEALTH_LABELS[key], why });
  const spending = input.monthlySpendingCents;
  const income = input.monthlyIncomeCents;

  if (input.cashCents === null || !spending || spending <= 0) {
    skip("cushion", "Jane needs your balances and a few months of spending to count this.");
  } else {
    const months = Math.max(0, input.cashCents) / spending;
    parts.push(
      part(
        "cushion",
        months / HEALTH_CUSHION_FULL_MONTHS,
        months >= 1
          ? `Your cash would cover ${cover(months)} of spending.`
          : `Your ${formatCents(Math.max(0, input.cashCents))} in cash would cover ${cover(months)} of spending.`,
        `Building toward ${HEALTH_CUSHION_FULL_MONTHS} months raises this; an emergency fund goal does it a paycheck at a time.`,
      ),
    );
  }

  if (!income || income <= 0 || spending === null) {
    skip("margin", "Jane needs a few months of income to count this.");
  } else {
    const rate = (income - spending) / income;
    parts.push(
      part(
        "margin",
        (rate - HEALTH_MARGIN_ZERO_RATE) / (HEALTH_MARGIN_FULL_RATE - HEALTH_MARGIN_ZERO_RATE),
        (rate >= 0
          ? `About ${Math.round(rate * 100)}% of what comes in is left after spending (last ${HEALTH_MONTHS} months).`
          : `Spending ran about ${Math.round(-rate * 100)}% above what came in over the last ${HEALTH_MONTHS} months.`) +
          (input.oneOffs?.length
            ? ` One-off costs (${formatCents(input.oneOffs.reduce((s, o) => s + o.amountCents, 0))}) are left out.`
            : ""),
        `Keeping ${Math.round(HEALTH_MARGIN_FULL_RATE * 100)}% of what comes in gives full points; the savings in your plan help.`,
      ),
    );
  }

  if (input.slips === null) {
    skip("onTime", "Jane needs your transactions to count this.");
  } else {
    const max = HEALTH_WEIGHTS.onTime;
    parts.push(
      part(
        "onTime",
        (max - input.slips * HEALTH_POINTS_PER_SLIP) / max,
        input.slips === 0
          ? `No late or overdraft fees in the last ${HEALTH_SLIP_DAYS} days.`
          : `${plural(input.slips, "late or overdraft fee")} in the last ${HEALTH_SLIP_DAYS} days.`,
        "Each fee drops out after 90 days; Jane can schedule card payments before they're due.",
      ),
    );
  }

  if (input.cardBalanceCents === null) {
    skip(
      "cards",
      input.cardsLinked
        ? "Jane doesn't know your card balance yet: add it on the import page."
        : "No credit cards linked.",
    );
  } else if (input.cardBalanceCents <= 0) {
    parts.push(part("cards", 1, "No card balance carried.", ""));
  } else if (!income || income <= 0) {
    skip("cards", "Jane needs a few months of income to count this.");
  } else {
    const months = input.cardBalanceCents / income;
    parts.push(
      part(
        "cards",
        1 - months / HEALTH_CARDS_ZERO_MONTHS,
        `Card balances of ${formatCents(input.cardBalanceCents)}, about ${one(months)} ${months === 1 ? "month" : "months"} of income.`,
        "Paying down the highest-rate card first raises this fastest.",
      ),
    );
  }

  if (input.goals.total === 0) {
    skip("goals", "No savings goals yet.");
  } else {
    parts.push(
      part(
        "goals",
        input.goals.onTrack / input.goals.total,
        `${input.goals.onTrack} of ${plural(input.goals.total, "savings goal")} on track.`,
        "Moving a goal's date or amount can put it back on track.",
      ),
    );
  }

  if (parts.length < HEALTH_MIN_PARTS) return null;
  const counted = {
    points: parts.reduce((s, p) => s + p.points, 0),
    max: parts.reduce((s, p) => s + p.max, 0),
  };
  const score = Math.round((100 * counted.points) / counted.max);
  return { score, band: bandOf(score), parts, left, counted };
}

export type HealthChange = { delta: number; biggest: { label: string; delta: number } | null };

// What changed since an earlier score: the move, and the part that moved it most.
export function healthChange(
  now: Pick<HealthScore, "score" | "parts">,
  before: Pick<HealthScore, "score" | "parts">,
): HealthChange {
  const moves = now.parts.map((p) => ({
    label: p.label,
    delta: p.points - (before.parts.find((b) => b.part === p.part)?.points ?? p.points),
  }));
  const biggest = moves
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  return { delta: now.score - before.score, biggest: biggest ?? null };
}
