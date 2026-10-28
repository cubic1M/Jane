// The investing leak: the dollars a year a person's investing loses, added up once. Fund costs,
// cash waiting inside investment accounts, a missed employer match, tax paid that placement and
// harvesting could save, and the costs of an old plan or an annuity. Each is a suggestion a
// detector already made (src/detectors), so the figure and the card always agree. Where two
// describe the same dollars (a fund's cost is also the old plan's fee gap, or the plan menu's
// saving), only the larger counts, so nothing is counted twice. Cash in checking and savings is
// the money page's idle-cash finding and is left out, so Home's money found never counts it
// twice either. Pure.

export type LeakInput = { topic: string; worthCents: number; worthKind: string };

export type LeakPart = {
  key: "costs" | "cash" | "match" | "tax" | "annuity";
  label: string;
  cents: number;
  // The suggestion topics that make it up (only the largest of an overlapping group counts).
  topics: string[];
};

export type Leak = { totalCents: number; parts: LeakPart[] };

type Group = {
  key: LeakPart["key"];
  label: string;
  // "max": the topics describe the same dollars, count the largest. "sum": they add up.
  how: "max" | "sum";
  topics: readonly string[];
};

const GROUPS: readonly Group[] = [
  {
    key: "costs",
    label: "Fund and plan costs",
    how: "max",
    topics: ["investment_fees", "plan_menu", "old_accounts"],
  },
  {
    key: "cash",
    label: "Cash waiting in investment accounts",
    how: "sum",
    topics: ["invested_cash"],
  },
  { key: "match", label: "Employer match not used", how: "sum", topics: ["employer_match"] },
  {
    key: "tax",
    label: "Tax you could avoid paying",
    how: "sum",
    topics: ["asset_location", "tax_loss_harvest"],
  },
  { key: "annuity", label: "A costly annuity", how: "sum", topics: ["costly_products"] },
];

// Only money lost every year counts: a suggestion that saves or earns, never one that guards
// against a risk (concentration, a missing beneficiary) or a one-time chance.
const LEAKING = new Set(["saves", "earns"]);

export function investingLeak(suggestions: readonly LeakInput[]): Leak {
  const parts: LeakPart[] = [];
  for (const g of GROUPS) {
    const found = suggestions.filter(
      (s) => g.topics.includes(s.topic) && LEAKING.has(s.worthKind) && s.worthCents > 0,
    );
    if (found.length === 0) continue;
    const cents =
      g.how === "max"
        ? Math.max(...found.map((s) => s.worthCents))
        : found.reduce((n, s) => n + s.worthCents, 0);
    parts.push({
      key: g.key,
      label: g.label,
      cents,
      topics: [...new Set(found.map((s) => s.topic))],
    });
  }
  parts.sort((a, b) => b.cents - a.cents);
  return { totalCents: parts.reduce((n, p) => n + p.cents, 0), parts };
}
