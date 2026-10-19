import type { AutopilotChoice } from "@/config/autopilot";

// One autopilot, every sector (spec step 141). On top of step 57's level, each sector has
// its own level and two dollar caps: the most one action may move or commit, and the most
// all of a month's actions may. Anything over a cap, or above the sector's level, Jane asks
// about instead. Free checks (reshops, rate checks, keeping things current) run at every
// level: they cost nothing and change nothing.

export const SECTORS = ["bills", "insurance", "debt", "taxes", "investing", "goals"] as const;
export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABELS: Record<Sector, string> = {
  bills: "Subscriptions and bills",
  insurance: "Insurance",
  debt: "Debt",
  taxes: "Taxes",
  investing: "Investing",
  goals: "Goals and budgets",
};

// Words people use for each sector, for "let Jane handle insurance up to $50 a month".
export const SECTOR_WORDS: Record<Sector, readonly string[]> = {
  bills: ["bills", "subscriptions", "subscription", "bill", "fees", "refunds"],
  insurance: ["insurance", "policies", "policy", "cover"],
  debt: ["debt", "debts", "loans", "loan", "cards", "credit cards"],
  taxes: ["taxes", "tax"],
  investing: ["investing", "investments", "investment", "portfolio"],
  goals: ["goals", "budgets", "budget", "savings", "goal"],
};

// A sector's level: "ask" (always ask), "safe" (only what can't cost the person: money
// comes back or stays theirs) or "all" (everything a sector allows, within the caps).
export const SECTOR_LEVELS = ["ask", "safe", "all"] as const;
export type SectorLevel = (typeof SECTOR_LEVELS)[number];

export const SECTOR_LEVEL_LABELS: Record<SectorLevel, string> = {
  ask: "Always ask",
  safe: "The safe stuff",
  all: "Everything allowed",
};

export type SectorSetting = { level: SectorLevel; actionCapCents: number; monthlyCapCents: number };

const ASK: SectorSetting = { level: "ask", actionCapCents: 0, monthlyCapCents: 0 };

// What each sector does by default at each step 57 level. "Ask me first" asks everywhere
// (and wins over anything set per sector); custom rules keep "Handle the safe stuff".
// No default is ever "Everything allowed": step 57 promises that moving money out,
// cancelling and insurance wait for a yes, so a sector acts like that only when the person
// sets it themselves. "The safe stuff" covers money that comes back or stays the person's,
// like a transfer to their own savings; the caps bound it.
export const SECTOR_DEFAULTS: Record<AutopilotChoice, Record<Sector, SectorSetting>> = {
  ask: {
    bills: ASK,
    insurance: ASK,
    debt: ASK,
    taxes: ASK,
    investing: ASK,
    goals: ASK,
  },
  safe: {
    bills: { level: "safe", actionCapCents: 12_000, monthlyCapCents: 50_000 },
    insurance: ASK,
    debt: { level: "safe", actionCapCents: 10_000, monthlyCapCents: 30_000 },
    taxes: { level: "safe", actionCapCents: 50_000, monthlyCapCents: 100_000 },
    investing: ASK,
    goals: { level: "safe", actionCapCents: 50_000, monthlyCapCents: 100_000 },
  },
  all: {
    bills: { level: "safe", actionCapCents: 50_000, monthlyCapCents: 150_000 },
    insurance: ASK,
    debt: { level: "safe", actionCapCents: 50_000, monthlyCapCents: 150_000 },
    taxes: { level: "safe", actionCapCents: 200_000, monthlyCapCents: 400_000 },
    investing: ASK,
    goals: { level: "safe", actionCapCents: 200_000, monthlyCapCents: 400_000 },
  },
};

// What "Everything allowed" lets each sector do by itself, within its caps, once the
// person sets it. Shown in Settings and said in the chat.
export const SECTOR_ALL_MEANS: Record<Sector, string> = {
  bills: "pay bills and card payments before they're due",
  insurance: "switch to a cheaper policy with the same cover",
  debt: "make extra payments toward your debts",
  taxes: "set money aside for taxes",
  investing: "move money into investing",
  goals: "move money to your goals and emergency fund",
};

// The highest cap anyone may set ($100,000), so a typo can't hand Jane everything.
export const MAX_SECTOR_CAP_CENTS = 10_000_000;
