import type { HealthPart } from "@/config/health-score";
import type { TabKey } from "@/config/navigation";

// The areas of the home hub and the feature map (docs/design/home-hub.md): one per area tab
// after Home, in tab order. Each of Jane's capabilities (src/lib/jane-agent/capabilities)
// belongs to one area, or to Jane itself (null); the hub's health dots and the feature map
// both read this, and ./areas.test.ts fails on a capability with no entry.

export type AreaKey = Extract<
  TabKey,
  "money" | "insurance" | "loans" | "taxes" | "investments" | "ahead"
>;

export const AREA_KEYS: readonly AreaKey[] = [
  "money",
  "insurance",
  "loans",
  "taxes",
  "investments",
  "ahead",
];

export const AREA_OF_CAPABILITY: Readonly<Record<string, AreaKey | null>> = {
  // Spending and bills.
  cost: "money",
  subscriptions: "money",
  payday: "money",
  safe_to_spend: "money",
  spending: "money",
  coming_up: "money",
  saved: "money",
  figures: "money",
  close: "money",
  books: "money",
  steady_pay: "money",
  price_rises: "money",
  two: "money",
  // The sectors.
  insurance: "insurance",
  debt: "loans",
  taxes: "taxes",
  investing: "investments",
  // Plans and goals.
  net_worth: "ahead",
  decision: "ahead",
  goals: "ahead",
  what_if: "ahead",
  long_view: "ahead",
  tradeoffs: "ahead",
  life_event: "ahead",
  // Jane itself: what it did, its autopilot, what it remembers, the whole picture.
  whole_picture: null,
  profile: null,
  did: null,
  act: null,
  autopilot: null,
  memory: null,
  // Claude's combined ideas (step 256) span areas.
  strategist: null,
};

export const areaOfCapability = (capability: string): AreaKey | null =>
  AREA_OF_CAPABILITY[capability] ?? null;

// The money health score's parts (src/planning/health-score.ts) that speak for each area. An
// area whose parts score under LOOK_BELOW of their points is worth a look.
export const AREA_HEALTH_PARTS: Readonly<Record<AreaKey, readonly HealthPart[]>> = {
  money: ["margin", "onTime"],
  insurance: [],
  loans: ["cards"],
  taxes: [],
  investments: [],
  ahead: ["cushion", "goals"],
};
export const HEALTH_LOOK_BELOW = 0.5;

// The cash-flow strip on the hub covers this many days from today.
export const CASH_FLOW_DAYS = 30;
// With less history than this, a monthly bill can't have shown twice, so an empty strip says
// there's too little to tell, not that nothing is due (debugger 11-14: a student with 26 days of one
// statement read "Nothing due in the next month", rent and all).
export const CASH_FLOW_MIN_HISTORY_DAYS = 45;
// What the strip, and the chat's coming-up and safe-to-spend answers, say then (debug 3, 11-19).
export const TOO_LITTLE_HISTORY =
  "Too little history to see your bills yet: they show once about two months of transactions are in.";
// The spending tile's bars: this many months, this one last.
export const SPENDING_MONTHS = 6;
// The goals tile draws at most this many goals.
export const GOALS_SHOWN = 4;
// The home hub's Saved tile, opened: the biggest this many savings, then "and N more".
export const SAVED_SHOWN = 3;
// The Safe to spend tile's "How it's worked out": each bill before payday on its own line, up to
// this many, then the rest as one line.
export const SAFE_BILLS_SHOWN = 5;
// The Saved tile's "Your plan": the biggest this many things on the plan.
export const PLAN_SHOWN = 3;
