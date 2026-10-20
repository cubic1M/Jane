import {
  HISTORY_MAX_FACTOR,
  MONEY_GROUPS,
  HISTORY_MIN_FACTOR,
  FINDING_KIND_OF_TOPIC,
  NO_PENALTY,
  SUGGESTIONS_PER_DAY,
  URGENCY_WEIGHT,
  WORKED_DOWN_FACTOR,
  WORKED_MIN_DONE,
  WORKED_UP_FACTOR,
  WORTH_WEIGHT,
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

// What the person's own answers do to a topic: 1 with none, up with yes, down with no.
export function historyFactor(topic: string, history: TopicHistory): number {
  const h = history[topic];
  if (!h) return 1;
  const factor = (1 + h.yes * YES_BOOST) * Math.pow(NO_PENALTY, h.no);
  return Math.min(HISTORY_MAX_FACTOR, Math.max(HISTORY_MIN_FACTOR, factor));
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

// dollars x confidence x urgency, adjusted by the person's answers. A whole number.
export function scoreOf(
  s: Suggestion,
  history: TopicHistory = {},
  results: KindResults = [],
): number {
  return Math.round(
    (s.rankCents ?? s.worthCents * WORTH_WEIGHT[s.worthKind]) *
      (s.confidence.percent / 100) *
      URGENCY_WEIGHT[s.urgency] *
      historyFactor(s.topic, history) *
      workedFactor(s.topic, results),
  );
}

// Highest first; ties by id so the order never changes between runs. `blocked` are
// suggestions never to show (a no) or not to show again yet.
export function rankSuggestions(
  suggestions: readonly Suggestion[],
  {
    history = {},
    results = [],
    blocked = new Set<string>(),
  }: { history?: TopicHistory; results?: KindResults; blocked?: ReadonlySet<string> } = {},
): Ranked[] {
  return suggestions
    .filter((s) => !blocked.has(s.id))
    .map((suggestion) => ({ suggestion, score: scoreOf(suggestion, history, results) }))
    .sort((a, b) => b.score - a.score || a.suggestion.id.localeCompare(b.suggestion.id));
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
