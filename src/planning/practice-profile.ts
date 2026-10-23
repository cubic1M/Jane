import { GLIDE_PATH_SOURCE, RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  AUTOPILOT_LIMITS,
  classTickers,
  MODEL_PORTFOLIOS,
  OPPORTUNITY_LEVELS,
  PRACTICE_ETFS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import {
  APPETITE_ORDER,
  APPETITES,
  AVOIDED_CLASS_FALLBACK,
  LEVEL_WORST_DROP_PERCENT,
  OPPORTUNITY_HARD_CAPS,
  OPPORTUNITY_HARD_MAX_SHARE,
  OPPORTUNITY_MIN_APPETITE,
  TICKER_TAGS,
} from "@/config/practice-preferences";
import {
  OPPORTUNITY_MAX_SHARE,
  SCAN_CAPS,
  SCAN_KINDS,
  type ScanKind,
} from "@/config/practice-scan";
import { glideMix, yearsUntil } from "./goal-buckets";
import type { ScanPreferences } from "./practice-opportunities";
import { avoidLabel, type PracticePreferences } from "./practice-preferences";

// What the autopilot and the daily scan do for one person (Phase AW, Stage A): their preferences
// turned into the mix, the caps and the rules, in one plain object (no functions, no dates as
// objects) that the autopilot, the scan and the backtests all read. Pure. Hard limits always
// win: nothing a preference says can raise AUTOPILOT_LIMITS or the opportunity hard caps, or
// bring opportunities below High. Practice money only.

export type Caps = { sizeShare: number; positionShare: number; perMonth: number };

export type PracticeProfile = {
  // The level the mix is built from, and the one chosen before the drop limit.
  level: RiskLevel;
  chosenLevel: RiskLevel;
  // Shares by kind; under 1 in all only when every fund of a kind and its fallbacks are avoided
  // (the rest stays as cash).
  weights: Record<PracticeClass, number>;
  // The goal date's glide path, when it moved the mix.
  glide: { goalDate: string; yearsLeft: number; stocksShare: number } | null;
  // False in suggest-only mode: no practice trades at all.
  trades: boolean;
  mode: PracticePreferences["mode"];
  // Every scan kind's caps; an extra move the appetite doesn't allow is all zeros.
  caps: Record<ScanKind, Caps>;
  opportunityKinds: ScanKind[];
  // All opportunity stocks together, at most.
  opportunityMaxShare: number;
  // Tickers never bought (named ones and the companies in an avoided group).
  avoid: string[];
  harvestLosses: boolean;
  cashBufferCents: number;
  monthly: { amountCents: number; day: number };
  limits: typeof AUTOPILOT_LIMITS;
  // What the profile does, in plain sentences, for the page, the chat and the backtests.
  rules: string[];
  // The level's strategy (the daily evaluation's choice, src/lib/investments/strategy-today.ts):
  // whether the mix follows it this month, and why or why not. Absent before the first
  // evaluation.
  strategy?: {
    key: string;
    label: string;
    why: string;
    followed: boolean;
    note: string;
  };
};

const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const LABEL: Record<PracticeClass, string> = {
  us_stocks: "US stocks",
  intl_stocks: "international stocks",
  bonds: "bonds",
  cash: "short-term bills",
};
const stocksOf = (w: Record<PracticeClass, number>) => w.us_stocks + w.intl_stocks;

// The highest level at or below the chosen one whose worst sample drop fits the limit.
export function levelForDrop(chosen: RiskLevel, maxDropPercent: number | null): RiskLevel {
  if (maxDropPercent === null) return chosen;
  for (let l = chosen; l >= 1; l--) {
    if (LEVEL_WORST_DROP_PERCENT[l as RiskLevel] <= maxDropPercent) return l as RiskLevel;
  }
  return 1;
}

// Every ticker the practice portfolio could buy that the person said never to buy.
export function avoidedTickers(avoid: readonly string[]): string[] {
  const groups = new Set(avoid);
  const tickers = new Set([...PRACTICE_UNIVERSE, ...Object.keys(TICKER_TAGS)]);
  return [...tickers].filter(
    (t) => groups.has(t) || (TICKER_TAGS[t] ?? []).some((tag) => groups.has(tag)),
  );
}

// The mix as the goal nears: the level's own mix until the glide path (step 157's) holds fewer
// stocks, then the glide path's, so the mix only ever gets safer as the date comes closer.
export function glideWeights(
  level: RiskLevel,
  goalDate: string | null,
  today: string,
): { weights: Record<PracticeClass, number>; yearsLeft: number | null; moved: boolean } {
  const base = { ...MODEL_PORTFOLIOS[level].weights };
  if (!goalDate) return { weights: base, yearsLeft: null, moved: false };
  const yearsLeft = yearsUntil(today, goalDate);
  const glide = glideMix(yearsLeft, level);
  if (stocksOf(glide) >= stocksOf(base) - 1e-9) return { weights: base, yearsLeft, moved: false };
  return { weights: { ...glide }, yearsLeft, moved: true };
}

// A kind with every fund avoided gives its share to its fallback, then bonds, then bills.
function withoutAvoided(weights: Record<PracticeClass, number>, avoid: ReadonlySet<string>) {
  const open = (c: PracticeClass) => classTickers(c).some((t) => !avoid.has(t));
  const out = { ...weights };
  const moved: string[] = [];
  for (const c of CLASSES) {
    if (open(c) || out[c] === 0) continue;
    const to = [AVOIDED_CLASS_FALLBACK[c], "bonds" as const, "cash" as const].find(
      (k) => k !== c && open(k),
    );
    if (to) {
      out[to] += out[c];
      moved.push(`${LABEL[c]} go to ${LABEL[to]}, because every ${LABEL[c]} fund is avoided`);
    } else {
      moved.push(
        `${LABEL[c]} stay as uninvested cash, because every fund that could hold them is avoided`,
      );
    }
    out[c] = 0;
  }
  return { weights: out, moved };
}

function opportunityCaps(appetite: PracticePreferences["appetite"], level: RiskLevel) {
  const scale = APPETITES[appetite].scale;
  const caps = {} as Record<ScanKind, Caps>;
  const kinds: ScanKind[] = [];
  for (const kind of SCAN_KINDS) {
    const base = SCAN_CAPS[kind];
    const min = OPPORTUNITY_MIN_APPETITE[kind];
    if (!min) {
      caps[kind] = { ...base };
      continue;
    }
    const hard = OPPORTUNITY_HARD_CAPS[kind] ?? base;
    const allowed =
      APPETITE_ORDER.indexOf(appetite) >= APPETITE_ORDER.indexOf(min) &&
      // News ideas stay at High and Very high, whatever the appetite.
      (kind !== "news_idea" || OPPORTUNITY_LEVELS.includes(level));
    caps[kind] = allowed
      ? {
          sizeShare: Math.min(base.sizeShare * scale, hard.sizeShare),
          positionShare: Math.min(base.positionShare, hard.positionShare),
          perMonth: Math.min(Math.floor(base.perMonth * scale), hard.perMonth),
        }
      : { sizeShare: 0, positionShare: 0, perMonth: 0 };
    if (allowed && caps[kind].perMonth > 0) kinds.push(kind);
  }
  return {
    caps,
    kinds,
    maxShare: Math.min(OPPORTUNITY_MAX_SHARE * scale, OPPORTUNITY_HARD_MAX_SHARE),
  };
}

export function profileFor(
  prefs: PracticePreferences,
  // The level when the person hasn't picked one (the portfolio's or the questionnaire's).
  context: { level: RiskLevel; today: string },
): PracticeProfile {
  const chosenLevel = prefs.riskLevel ?? context.level;
  const level = levelForDrop(chosenLevel, prefs.maxDropPercent);
  const glide = glideWeights(level, prefs.goalDate, context.today);
  const avoid = avoidedTickers(prefs.avoid);
  const { weights, moved } = withoutAvoided(glide.weights, new Set(avoid));
  const opp = opportunityCaps(prefs.appetite, level);
  const trades = prefs.mode === "act";

  const rules: string[] = [];
  rules.push(
    trades
      ? "Jane trades the practice portfolio herself, inside every limit."
      : "Suggest only: Jane says what she would do and places no practice trades.",
  );
  rules.push(
    level === chosenLevel
      ? `The mix is the ${RISK_LEVELS[level].label} model.`
      : `The mix is the ${RISK_LEVELS[level].label} model, not ${RISK_LEVELS[chosenLevel].label}, because its worst sample drop (${LEVEL_WORST_DROP_PERCENT[chosenLevel]}%) is more than the ${prefs.maxDropPercent}% you can live with.`,
  );
  if (glide.moved && glide.yearsLeft !== null) {
    rules.push(
      `Your goal is ${glide.yearsLeft < 1 ? "less than a year" : `about ${Math.round(glide.yearsLeft)} years`} away, so stocks are ${pct(stocksOf(glide.weights))} instead of ${pct(stocksOf(MODEL_PORTFOLIOS[level].weights))}, moving toward bonds and cash as the date nears (${GLIDE_PATH_SOURCE}).`,
    );
  }
  for (const m of moved) rules.push(`${m[0].toUpperCase()}${m.slice(1)}.`);
  if (prefs.avoid.length > 0) {
    rules.push(`Never bought: ${prefs.avoid.map(avoidLabel).join(", ")}.`);
  }
  rules.push(
    opp.kinds.length === 0
      ? "No extra moves: just the model, kept on target."
      : `Extra moves (${APPETITES[prefs.appetite].label.toLowerCase()}): ${opp.kinds
          .map(
            (k) =>
              `${k.replace(/_/g, " ")} up to ${pct(opp.caps[k].sizeShare)} each, ${opp.caps[k].perMonth} a month`,
          )
          .join("; ")}.`,
  );
  rules.push(
    prefs.harvestLosses
      ? "Losses worth harvesting are swapped into a similar fund."
      : "Losses aren't harvested.",
  );
  if (prefs.cashBufferCents > 0) {
    rules.push(`$${(prefs.cashBufferCents / 100).toLocaleString("en-US")} is always kept in cash.`);
  }

  return {
    level,
    chosenLevel,
    weights,
    glide:
      glide.moved && prefs.goalDate && glide.yearsLeft !== null
        ? { goalDate: prefs.goalDate, yearsLeft: glide.yearsLeft, stocksShare: stocksOf(weights) }
        : null,
    trades,
    mode: prefs.mode,
    caps: {
      ...opp.caps,
      // Loss harvesting off: none a month.
      tax_loss_harvest: prefs.harvestLosses
        ? opp.caps.tax_loss_harvest
        : { ...opp.caps.tax_loss_harvest, perMonth: 0 },
    },
    opportunityKinds: opp.kinds,
    opportunityMaxShare: opp.maxShare,
    avoid,
    harvestLosses: prefs.harvestLosses,
    cashBufferCents: prefs.cashBufferCents,
    monthly: { amountCents: prefs.monthlyAddCents, day: prefs.addDay },
    limits: AUTOPILOT_LIMITS,
    rules,
  };
}

// The last check before any practice order, from the autopilot or the scan: why the person's
// preferences refuse it, or null. Suggest only refuses every order; a buy of anything on the
// never-buy list is refused. The hard limits are checked separately (violates) and always apply.
export function refusedByPreferences(
  profile: Pick<PracticeProfile, "trades" | "avoid">,
  order: { ticker: string; side: "buy" | "sell" },
): string | null {
  if (!profile.trades) return "suggest only";
  if (order.side === "buy" && profile.avoid.includes(order.ticker.toUpperCase()))
    return "on your never-buy list";
  return null;
}

// The first of a flag's trades the person's preferences refuse (the never-buy list), or null.
// Suggest only is the scan's own status, so it is left out here. The live scan and the rule
// replay both ask this before the hard limits.
export function firstRefusal(
  profile: Pick<PracticeProfile, "avoid">,
  flag: { trades: readonly { ticker: string; side: "buy" | "sell" }[] },
): string | null {
  return (
    flag.trades
      .map((t) => refusedByPreferences({ ...profile, trades: true }, t))
      .find((r) => r !== null) ?? null
  );
}

const APPETITE: Readonly<Record<PracticePreferences["appetite"], ScanPreferences["appetite"]>> = {
  off: "none",
  cautious: "low",
  normal: "normal",
  adventurous: "high",
};

// The person's preferences in the daily scan's terms. The drop they can live with falls back to
// `fallbackDropShare` (the investor profile's answer, read by src/lib/practice/opportunity-prefs.ts)
// when they haven't said one. The live scan and the rule replay both build it here.
export function scanPreferencesFor(
  prefs: PracticePreferences,
  fallbackDropShare: number | null = null,
): ScanPreferences {
  return {
    maxDropShare: prefs.maxDropPercent === null ? fallbackDropShare : prefs.maxDropPercent / 100,
    goalDate: prefs.goalDate,
    appetite: APPETITE[prefs.appetite],
    excludedTickers: avoidedTickers(prefs.avoid),
    taxSensitive: prefs.harvestLosses,
    cashBufferCents: prefs.cashBufferCents,
    mode: prefs.mode,
  };
}
