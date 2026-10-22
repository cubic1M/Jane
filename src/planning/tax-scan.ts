import { TAX_TOPIC_MONTH } from "@/config/tax-calendar";
import type { Suggestion } from "@/detectors/contract";
import { rankSuggestions } from "@/planning/suggestion-rank";

// Taxes on autopilot, round three (spec step 273). Pure: every tax suggestion from the whole
// scan, ranked with all the others (its place in the person's full list), and put in the month
// of the tax calendar it belongs in.

export type TaxFound = {
  topic: string;
  headline: string;
  short: string;
  worthCents: number;
  worthKind: Suggestion["worthKind"];
  percent: number;
  urgency: Suggestion["urgency"];
  href: string;
  // 1 for the most important suggestion of everything Jane found for the person.
  rank: number;
  // The calendar month it goes in (1 to 12).
  month: number;
};

// The month a suggestion goes in, from today's month.
export function monthFor(topic: string, urgency: Suggestion["urgency"], today: number): number {
  const home = TAX_TOPIC_MONTH[topic] ?? today;
  if (urgency === "now") return today;
  const ahead = (home - today + 12) % 12;
  if (urgency === "soon") return ahead <= 1 ? home : (today % 12) + 1;
  return home;
}

export function taxFound(all: readonly Suggestion[], todayMonth: number): TaxFound[] {
  const ranked = rankSuggestions(all);
  return ranked.flatMap((r, i) =>
    r.suggestion.capability === "taxes"
      ? [
          {
            topic: r.suggestion.topic,
            headline: r.suggestion.headline,
            short: r.suggestion.short,
            worthCents: r.suggestion.worthCents,
            worthKind: r.suggestion.worthKind,
            percent: r.suggestion.confidence.percent,
            urgency: r.suggestion.urgency,
            href: r.suggestion.action.href,
            rank: i + 1,
            month: monthFor(r.suggestion.topic, r.suggestion.urgency, todayMonth),
          },
        ]
      : [],
  );
}
