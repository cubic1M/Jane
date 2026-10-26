import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { CompareRow, OfferedOptions, OptionCardKind, OptionCompare } from "@/lib/option-card";

// Comparison cards (founder, 2026-10-24): wherever Jane recommends insurance or a loan, the
// options side by side, each with its name, its monthly figure, three or four rows that line
// up across the cards, who it's best for and a short tag. A preference at the top re-ranks
// them on the screen, with no trip to the server. Built from the shared pick-one card
// (src/lib/option-card.ts), so the chat, the area pages and the floating cards show the same
// thing. Pure: src/components/comparison-cards.tsx draws it.

export const PREFERENCES = {
  cheapest: "Cheapest",
  best_cover: "Best coverage",
  lowest_monthly: "Lowest monthly",
  lowest_total: "Lowest total cost",
  fastest_payoff: "Fastest payoff",
} as const;
export type Preference = keyof typeof PREFERENCES;

// The preferences that mean something for each kind, the default first.
export const KIND_PREFERENCES: Record<OptionCardKind, readonly Preference[]> = {
  insurance: ["cheapest", "best_cover"],
  loan: ["lowest_total", "lowest_monthly", "fastest_payoff"],
};

export const TAGS = {
  cheapest: "CHEAPEST",
  best_cover: "BEST COVER",
  lowest_monthly: "LOWEST MONTHLY",
  lowest_total: "LOWEST TOTAL",
  fastest_payoff: "FASTEST PAYOFF",
} as const satisfies Record<Preference, string>;
export type Tag = (typeof TAGS)[Preference];

export type ComparedOption = {
  id: string;
  name: string;
  // The headline number, whole dollars a month: "$106".
  monthly: string;
  // The card's rows in the comparison's row order; "—" where an option has none.
  rows: CompareRow[];
  bestFor: string;
  tags: Tag[];
  isPick: boolean;
  why: string;
  confidence: { percent: number; reason: string } | null;
  // Everything else for "More details".
  details: string[];
  metrics: Omit<OptionCompare, "rows" | "bestFor">;
};

export type Comparison = {
  kind: OptionCardKind;
  title: string;
  // What a pick is checked against on the server (src/lib/compare-actions.ts).
  topic: string;
  policyId: string | null;
  newCover: boolean;
  advice: boolean;
  preferences: readonly Preference[];
  // The order it opens in.
  initial: Preference;
  // Every row key in order, and whether the options differ on it (differing rows are
  // emphasised, identical ones dimmed).
  rows: { key: string; label: string; differs: boolean }[];
  // In the card's own order (Jane's pick first when it has one).
  options: ComparedOption[];
};

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));

type Metrics = ComparedOption["metrics"];

// Smaller is better for each preference; ties go to the next key, then to the card's order.
const KEYS: Record<Preference, ((m: Metrics) => number)[]> = {
  cheapest: [(m) => m.totalCents, (m) => -(m.coverScore ?? 0)],
  best_cover: [(m) => -(m.coverScore ?? 0), (m) => m.totalCents],
  lowest_monthly: [(m) => m.monthlyCents, (m) => m.totalCents],
  lowest_total: [(m) => m.totalCents, (m) => m.monthlyCents],
  fastest_payoff: [(m) => m.payoffMonths ?? Number.MAX_SAFE_INTEGER, (m) => m.totalCents],
};

// The options in the order a preference puts them; stable, so equal ones keep the card's order.
export function rank<T extends { metrics: Metrics }>(options: readonly T[], by: Preference): T[] {
  const keys = KEYS[by];
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      for (const key of keys) {
        const d = key(a.o.metrics) - key(b.o.metrics);
        if (d !== 0) return d;
      }
      return a.i - b.i;
    })
    .map(({ o }) => o);
}

// The tags an option wins: it alone is first by that preference's main figure.
function tagsOf(all: readonly { id: string; metrics: Metrics }[], kind: OptionCardKind) {
  const won = new Map<string, Tag[]>(all.map((o) => [o.id, []]));
  if (all.length < 2) return won;
  for (const pref of KIND_PREFERENCES[kind]) {
    const main = KEYS[pref][0];
    const values = all.map((o) => main(o.metrics));
    const best = Math.min(...values);
    if (values.filter((v) => v === best).length !== 1) continue;
    won.get(all[values.indexOf(best)].id)!.push(TAGS[pref]);
  }
  return won;
}

// The insurance card's label carries the rating ("Lighthouse (rated A)"); it's a row here.
const nameOf = (label: string) => label.replace(/\s*\(rated [^)]*\)$/, "");

// Null when the card was saved before it carried the comparison's numbers.
export function toComparison(card: OfferedOptions): Comparison | null {
  if (card.options.length === 0 || card.options.some((o) => !o.compare)) return null;
  const keys: { key: string; label: string }[] = [];
  for (const o of card.options) {
    for (const r of o.compare!.rows) {
      if (!keys.some((k) => k.key === r.key)) keys.push({ key: r.key, label: r.label });
    }
  }
  const valueOf = (c: OptionCompare, key: string) =>
    c.rows.find((r) => r.key === key)?.value ?? "—";
  const rows = keys.map((k) => ({
    ...k,
    differs: new Set(card.options.map((o) => valueOf(o.compare!, k.key))).size > 1,
  }));
  const base = card.options.map((o) => {
    const c = o.compare!;
    const metrics: Metrics = {
      monthlyCents: c.monthlyCents,
      totalCents: c.totalCents,
      coverScore: c.coverScore,
      payoffMonths: c.payoffMonths,
    };
    return { id: o.id, metrics };
  });
  const tags = tagsOf(base, card.kind);
  const options = card.options.map((o, i): ComparedOption => {
    const c = o.compare!;
    const pick = card.advice && o.isPick;
    return {
      id: o.id,
      name: nameOf(o.label),
      monthly: dollars(c.monthlyCents),
      rows: keys.map((k) => ({ ...k, value: valueOf(c, k.key) })),
      bestFor: c.bestFor,
      tags: tags.get(o.id) ?? [],
      isPick: pick,
      why: o.whyThisOne,
      confidence: card.advice && o.confidence ? o.confidence : null,
      details: [...o.facts, ...o.details].filter((d) => d !== DEMO_ADVICE_LABEL),
      metrics: base[i].metrics,
    };
  });
  const preferences = KIND_PREFERENCES[card.kind];
  // Opens on the preference that already puts Jane's pick first, if one does.
  const pick = options.find((o) => o.isPick);
  const initial = (pick && preferences.find((p) => rank(options, p)[0] === pick)) ?? preferences[0];
  return {
    kind: card.kind,
    title: card.title,
    topic: card.topic,
    policyId: card.policyId ?? null,
    newCover: card.newCover,
    advice: card.advice,
    preferences,
    initial,
    rows,
    options,
  };
}

// What a pick does, said once under the cards.
export const WHAT_A_PICK_DOES: Record<OptionCardKind, string> = {
  insurance: "Jane's team sets it up by hand. Nothing changes until they confirm it with you.",
  loan: "Jane's team sends you the lender's own steps; you apply yourself. Nothing is moved.",
};
