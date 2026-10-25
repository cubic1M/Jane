import {
  ACT_PRIOR_RATE,
  ACT_WEIGHT,
  KIND_MAX_FACTOR,
  KIND_MIN_FACTOR,
  PAYOFF_PRIOR_RATE,
  PAYOFF_WEIGHT,
  PEOPLE_LINE_MIN_SHOWN,
  PRIOR_WEIGHT,
  HISTORY_FLOOR_BY_TOPIC,
  HISTORY_MAX_FACTOR,
  MONEY_GROUPS,
  HISTORY_MIN_FACTOR,
  FINDING_KIND_OF_TOPIC,
  LOW_CONFIDENCE_PERCENT,
  RANK_TIE_RATIO,
  NO_PENALTY,
  SUGGESTIONS_PER_DAY,
  URGENCY_WEIGHT,
  WORKED_DOWN_FACTOR,
  WORKED_MIN_DONE,
  WORKED_UP_FACTOR,
  REQUIRED_BOOST,
  rankValue,
  YES_BOOST,
} from "@/config/suggestions";
import type { Suggestion } from "@/detectors/contract";

// Ranking what the detectors found (spec step 255). Pure: the nightly scan
// (src/lib/suggestions.ts) loads the person's history and results, this orders and picks.

export type TopicHistory = Readonly<Record<string, { yes: number; no: number }>>;
// What step 207 knows about each kind of finding (src/lib/worked.ts KindResult).
export type KindResults = readonly {
  type: string;
  done: number;
  worked: number;
  notShown: number;
}[];

export type Ranked = { suggestion: Suggestion; score: number };

// What everyone did with each kind of suggestion (the learning loop, src/lib/learning.ts).
export type KindStat = {
  topic: string;
  shown: number;
  acted: number;
  decided: number;
  paidOff: number;
};
export type KindStats = ReadonlyMap<string, KindStat>;

// A rate with its prior: as if PRIOR_WEIGHT more showings had gone the prior's way.
const withPrior = (hits: number, of: number, prior: number) =>
  (hits + prior * PRIOR_WEIGHT) / (of + PRIOR_WEIGHT);

// The learning loop: kinds people act on, and whose savings then show up, rank higher for
// everyone; kinds they pass over, or that don't pay off, lower. 1 with no history, within
// KIND_MIN_FACTOR and KIND_MAX_FACTOR.
export function kindFactor(topic: string, stats: KindStats = new Map()): number {
  const k = stats.get(topic);
  if (!k) return 1;
  const act = withPrior(k.acted, k.shown, ACT_PRIOR_RATE) / ACT_PRIOR_RATE;
  const payoff = withPrior(k.paidOff, k.decided, PAYOFF_PRIOR_RATE) / PAYOFF_PRIOR_RATE;
  const factor = Math.pow(act, ACT_WEIGHT) * Math.pow(payoff, PAYOFF_WEIGHT);
  return Math.min(KIND_MAX_FACTOR, Math.max(KIND_MIN_FACTOR, factor));
}

// The card's More details, once a kind has history: "People acted on this 7 of 10 times." In
// whole tens when there's more (never a false precision), with how often it paid off once that
// is known too. Null below PEOPLE_LINE_MIN_SHOWN.
export function peopleLine(topic: string, stats: KindStats = new Map()): string | null {
  const k = stats.get(topic);
  if (!k || k.shown < PEOPLE_LINE_MIN_SHOWN) return null;
  const tenths = Math.round((10 * k.acted) / k.shown);
  const acted =
    k.shown <= 10
      ? `People acted on this ${k.acted} of ${k.shown} times it was shown.`
      : `People acted on this about ${tenths} of every 10 times it was shown.`;
  if (k.decided < PEOPLE_LINE_MIN_SHOWN) return acted;
  const paid = Math.round((10 * k.paidOff) / k.decided);
  return `${acted} About ${paid} of every 10 who did saw the saving in their transactions.`;
}

// What the person's own answers do to a topic: 1 with none, up with yes, down with no. A
// safety topic never falls below its floor (HISTORY_FLOOR_BY_TOPIC).
export function historyFactor(topic: string, history: TopicHistory): number {
  const h = history[topic];
  if (!h) return 1;
  const factor = (1 + h.yes * YES_BOOST) * Math.pow(NO_PENALTY, h.no);
  const floor = HISTORY_FLOOR_BY_TOPIC[topic] ?? HISTORY_MIN_FACTOR;
  return Math.min(HISTORY_MAX_FACTOR, Math.max(floor, factor));
}

// What happened after yes (step 207): finished actions of the matching kind of finding that
// never showed a saving rank lower; ones that did rank higher.
export function workedFactor(topic: string, results: KindResults): number {
  const kind = FINDING_KIND_OF_TOPIC[topic as keyof typeof FINDING_KIND_OF_TOPIC];
  const r = kind ? results.find((x) => x.type === kind) : undefined;
  if (!r || r.done < WORKED_MIN_DONE) return 1;
  if (r.worked > 0) return WORKED_UP_FACTOR;
  return r.notShown > 0 ? WORKED_DOWN_FACTOR : 1;
}

// What the person can expect to gain: dollars x confidence, adjusted by the person's answers
// and what worked before. A whole number.
export function scoreOf(
  s: Suggestion,
  history: TopicHistory = {},
  results: KindResults = [],
  kinds: KindStats = new Map(),
): number {
  return Math.round(
    (s.rankCents ??
      (s.worthIsExpected ? s.worthCents : rankValue(s.topic, s.worthKind, s.worthCents))) *
      (s.required ? REQUIRED_BOOST : 1) *
      (s.confidence.percent / 100) *
      historyFactor(s.topic, history) *
      workedFactor(s.topic, results) *
      kindFactor(s.topic, kinds),
  );
}

// The order cards are shown in, from what's stored with each: what Jane is sure enough of
// (LOW_CONFIDENCE_PERCENT) before any guess, then the most a person can expect to gain (the
// score), with urgency breaking a tie (now, then soon, then later; gains in the same
// RANK_TIE_RATIO band count as tied), then the exact score, then the id so the order never
// changes between runs. The nightly scan and the chat's read-back both use it.
export type RankKey = { id: string; confidencePercent: number; score: number; urgency: string };

const urgencyWeight = (u: string) => URGENCY_WEIGHT[u as keyof typeof URGENCY_WEIGHT] ?? 0;
const band = (score: number) =>
  score > 0 ? Math.floor(Math.log(score) / Math.log(RANK_TIE_RATIO)) : -Infinity;

export function byRank(a: RankKey, b: RankKey): number {
  const sure = (k: RankKey) => (k.confidencePercent >= LOW_CONFIDENCE_PERCENT ? 1 : 0);
  return (
    sure(b) - sure(a) ||
    (band(b.score) === band(a.score) ? 0 : band(b.score) > band(a.score) ? 1 : -1) ||
    urgencyWeight(b.urgency) - urgencyWeight(a.urgency) ||
    b.score - a.score ||
    a.id.localeCompare(b.id)
  );
}

const keyOf = (r: Ranked): RankKey => ({
  id: r.suggestion.id,
  confidencePercent: r.suggestion.confidence.percent,
  score: r.score,
  urgency: r.suggestion.urgency,
});

// Best first (byRank). `blocked` are suggestions never to show (a no) or not to show again yet.
export function rankSuggestions(
  suggestions: readonly Suggestion[],
  {
    history = {},
    results = [],
    blocked = new Set<string>(),
    kinds = new Map(),
  }: {
    history?: TopicHistory;
    results?: KindResults;
    blocked?: ReadonlySet<string>;
    // What everyone did with each kind (the learning loop).
    kinds?: KindStats;
  } = {},
): Ranked[] {
  return suggestions
    .filter((s) => !blocked.has(s.id))
    .map((suggestion) => ({ suggestion, score: scoreOf(suggestion, history, results, kinds) }))
    .sort((a, b) => byRank(keyOf(a), keyOf(b)));
}

// The ones that reach the person today.
// Suggestions that touch the same money count it once (spec step 255): of those that share a
// money group (MONEY_GROUPS) only the highest-ranked stays. `ranked` must be best first.
export function mergeOverlaps(ranked: readonly Ranked[]): Ranked[] {
  const taken = new Set<string>();
  const out: Ranked[] = [];
  for (const r of ranked) {
    const groups = MONEY_GROUPS[r.suggestion.topic] ?? [];
    if (groups.some((g) => taken.has(g))) continue;
    for (const g of groups) taken.add(g);
    out.push(r);
  }
  return out;
}

// What a list of suggestions is worth a year, each piece of money counted once.
export function worthOnce(suggestions: readonly Suggestion[]): number {
  return mergeOverlaps(rankSuggestions(suggestions)).reduce(
    (s, r) => s + r.suggestion.worthCents,
    0,
  );
}

// An idea that combines suggestions and one of them are never both offered on one day.
export function pickForToday(
  ranked: readonly Ranked[],
  perDay: number = SUGGESTIONS_PER_DAY,
): Ranked[] {
  const out: Ranked[] = [];
  const taken = new Set<string>();
  for (const r of ranked) {
    if (out.length >= perDay) break;
    const ids = [r.suggestion.id, ...(r.suggestion.parts ?? [])];
    if (ids.some((id) => taken.has(id))) continue;
    out.push(r);
    for (const id of ids) taken.add(id);
  }
  return out;
}
