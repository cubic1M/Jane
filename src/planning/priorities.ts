import {
  CONFIDENCE_SCORE,
  PRIORITY_WEIGHTS,
  URGENCY_HORIZON_DAYS,
  URGENT_WITHIN_DAYS,
} from "@/config/priorities";
import { formatCents } from "@/lib/money";

// The next best thing to do (spec step 143). Pure: candidates in, ranked with their scores
// and the reason each sits where it does. Weights in src/config/priorities.ts.

// "suggestion": the nightly scan's (spec step 255), which lead the list in the scan's own order.
export type PriorityKind = "finding" | "offer" | "task" | "deadline" | "plan" | "suggestion";

export type PriorityItem = {
  key: string;
  kind: PriorityKind;
  title: string;
  // Money it saves or earns a year, when known.
  valueCents: number | null;
  // The value is money back once (a refund), not every year.
  once?: boolean;
  // Minutes of the person's time.
  minutes: number;
  // 0 to 1, or from a date.
  urgency?: number;
  dueOn?: string | null;
  confidence: keyof typeof CONFIDENCE_SCORE;
  href: string;
  // What the item is, for buttons (a finding's id, a shop's id, a suggestion's key).
  ref?: string;
  // A suggestion's worth is a loss avoided, not money saved.
  risk?: boolean;
  // How sure Jane is of a suggestion, as a percentage with its reason (spec step 254).
  sure?: { percent: number; reason: string };
};

export type Ranked = PriorityItem & { score: number; urgencyScore: number; why: string };

const DAY_MS = 86_400_000;
const daysUntil = (date: string, asOf: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS);

export function urgencyOf(item: Pick<PriorityItem, "urgency" | "dueOn">, asOf: string): number {
  if (item.dueOn) {
    const days = daysUntil(item.dueOn, asOf);
    if (days <= URGENT_WITHIN_DAYS) return 1;
    if (days >= URGENCY_HORIZON_DAYS) return item.urgency ?? 0;
    const fromDate = 1 - (days - URGENT_WITHIN_DAYS) / (URGENCY_HORIZON_DAYS - URGENT_WITHIN_DAYS);
    return Math.max(fromDate, item.urgency ?? 0);
  }
  return item.urgency ?? 0;
}

const perMinute = (item: PriorityItem) =>
  item.valueCents !== null && item.valueCents > 0
    ? item.valueCents / 100 / Math.max(1, item.minutes)
    : 0;

export function scoreOf(item: PriorityItem, asOf: string): { score: number; urgency: number } {
  const urgency = urgencyOf(item, asOf);
  const score =
    PRIORITY_WEIGHTS.value * Math.log10(1 + perMinute(item)) +
    PRIORITY_WEIGHTS.urgency * urgency +
    PRIORITY_WEIGHTS.confidence * CONFIDENCE_SCORE[item.confidence];
  return { score: Math.round(score * 1000) / 1000, urgency };
}

const timeWords = (minutes: number) =>
  minutes <= 1 ? "takes one tap" : `takes about ${minutes} minutes`;

// Why an item is where it is, in a few words: what stands out about it against the rest.
function reasonFor(item: Ranked, all: Ranked[], asOf: string): string {
  const reasons: string[] = [];
  if (item.dueOn && item.urgencyScore >= 1) {
    const days = daysUntil(item.dueOn, asOf);
    reasons.push(
      days < 0
        ? "it's overdue"
        : days === 0
          ? "it's due today"
          : `it's due in ${days} ${days === 1 ? "day" : "days"}`,
    );
  } else if (item.urgencyScore >= 0.6) {
    reasons.push(item.kind === "task" ? "my work waits on it" : "it can't wait long");
  }
  const mostCents = Math.max(...all.map((a) => a.valueCents ?? 0));
  if (item.valueCents !== null && item.valueCents > 0) {
    const cents = formatCents(item.valueCents);
    const most = item.valueCents === mostCents;
    reasons.push(
      item.once
        ? most
          ? `it gets the most back (${cents})`
          : `it gets ${cents} back`
        : most
          ? `it saves the most (${cents} a year)`
          : `it saves ${cents} a year`,
    );
  }
  // The time is said last; when it's the only reason it needs its own "it" (QA: "Because takes
  // one tap.").
  reasons.push(`${reasons.length === 0 ? "it " : ""}${timeWords(item.minutes)}`);
  return reasons.join(" and ").replace(/ and (?=[^,]* and )/, ", ");
}

// Highest score first. Ties: the bigger saving, then the earlier date, then the title.
export function rankPriorities(items: PriorityItem[], asOf: string): Ranked[] {
  const scored = items.map((item) => {
    const { score, urgency } = scoreOf(item, asOf);
    return { ...item, score, urgencyScore: urgency, why: "" };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.valueCents ?? 0) - (a.valueCents ?? 0) ||
      (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
  return scored.map((item, i) => {
    const reason = reasonFor(item, scored, asOf);
    return { ...item, why: i === 0 ? `First because ${reason}.` : `Because ${reason}.` };
  });
}
