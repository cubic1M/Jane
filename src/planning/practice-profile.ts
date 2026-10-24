import { CATALOG_EVIDENCE } from "@/config/catalog-evidence";
import { CATALOG, type CatalogId } from "@/config/strategy-catalog";
import { CRYPTO_EVIDENCE } from "@/config/crypto-evidence";
import { INTRADAY_EVIDENCE } from "@/config/intraday-evidence";
import {
  INTRADAY_RULES,
  INTRADAY_SLEEVE_BY_LEVEL,
  INTRADAY_WARNING,
  type IntradayRuleId,
} from "@/config/intraday-strategies";
import {
  CRYPTO_SLEEVE_BY_LEVEL,
  CRYPTO_STRATEGIES,
  type CryptoStrategyId,
} from "@/config/crypto-strategies";
import { GLIDE_PATH_SOURCE, RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  AUTOPILOT_LIMITS,
  swapPair,
  MODEL_PORTFOLIOS,
  OPPORTUNITY_LEVELS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  type AutopilotLimits,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import {
  APPETITE_ORDER,
  APPETITES,
  AVOIDED_CLASS_FALLBACK,
  LEVEL_WORST_DROP_PERCENT,
  MAX_FUND_RANGE,
  OPPORTUNITY_HARD_CAPS,
  OPPORTUNITY_HARD_MAX_SHARE,
  OPPORTUNITY_MIN_APPETITE,
  REBALANCE_PACES,
  STRATEGY_CHOICES,
  TICKER_TAGS,
  UNIVERSES,
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
  // The hard limits, with the person's rebalance band and per-fund cap (never above them).
  limits: AutopilotLimits;
  // Which strategy the person chose (STRATEGY_CHOICES); withStrategy (src/lib/practice/
  // preferences.ts) follows it.
  strategyChoice: PracticePreferences["strategy"];
  universe: PracticePreferences["universe"];
  // What the profile does, in plain sentences, for the page, the chat and the backtests.
  rules: string[];
  // The crypto sleeve the person chose (src/config/crypto-strategies.ts), with its rule's setting
  // from the evidence and the most of the portfolio it may be: null when off or below Very high.
  crypto: { strategy: CryptoStrategyId; param: number; share: number } | null;
  // The day-trading sleeve the person chose (src/config/intraday-strategies.ts), the same way:
  // null when off or below Very high.
  dayTrade: { rule: IntradayRuleId; param: number; share: number } | null;
  // A tested strategy (src/config/strategy-catalog.ts) the portfolio follows instead of the mix,
  // at its published middle setting: only one the research rates worth watching or recommendable
  // at this level (src/config/catalog-evidence.ts). Null otherwise.
  catalog: { id: CatalogId; param: number } | null;
  // The fund the person chose for a kind (a strategy menu tilt), set with the strategy below.
  funds?: Partial<Record<PracticeClass, string>>;
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

// Every ticker the practice portfolio could buy that the person said never to buy: what they
// named or grouped, and every company's shares when they chose funds only.
export function avoidedTickers(
  avoid: readonly string[],
  universe: PracticePreferences["universe"] = "funds_and_stocks",
): string[] {
  const groups = new Set(avoid);
  const stocks = new Set<string>(universe === "funds_only" ? PRACTICE_STOCKS : []);
  const tickers = new Set([...PRACTICE_UNIVERSE, ...Object.keys(TICKER_TAGS)]);
  return [...tickers].filter(
    (t) => stocks.has(t) || groups.has(t) || (TICKER_TAGS[t] ?? []).some((tag) => groups.has(tag)),
  );
}

// The limits for one person: the hard ones, with their rebalance pace's band and their cap on
// one fund, which can only lower the hard cap.
export function limitsFor(
  prefs: Pick<PracticePreferences, "rebalancePace" | "maxFundPercent">,
): AutopilotLimits {
  const fund = prefs.maxFundPercent === null ? 1 : prefs.maxFundPercent / 100;
  return {
    ...AUTOPILOT_LIMITS,
    rebalanceBand: REBALANCE_PACES[prefs.rebalancePace].band,
    perEtfShare: Math.min(AUTOPILOT_LIMITS.perEtfShare, fund),
  };
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
  const open = (c: PracticeClass) => swapPair(c).some((t) => !avoid.has(t));
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

function opportunityCaps(
  appetite: PracticePreferences["appetite"],
  level: RiskLevel,
  universe: PracticePreferences["universe"],
) {
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
      // News ideas stay at High and Very high, whatever the appetite, and buy a company's
      // shares, so never with funds only.
      (kind !== "news_idea" || (OPPORTUNITY_LEVELS.includes(level) && universe !== "funds_only"));
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
  const avoid = avoidedTickers(prefs.avoid, prefs.universe);
  const limits = limitsFor(prefs);
  const { weights, moved } = withoutAvoided(glide.weights, new Set(avoid));
  const opp = opportunityCaps(prefs.appetite, level, prefs.universe);
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
  rules.push(
    `Rebalanced ${REBALANCE_PACES[prefs.rebalancePace].label.toLowerCase()}: when a kind is ${Math.round(limits.rebalanceBand * 100)} points off its target.`,
  );
  if (prefs.maxFundPercent !== null && prefs.maxFundPercent < MAX_FUND_RANGE.max) {
    rules.push(
      `No fund over ${prefs.maxFundPercent}% of the portfolio; what that keeps out of a fund stays as cash.`,
    );
  }
  if (prefs.universe === "funds_only") rules.push(`${UNIVERSES.funds_only.description}`);
  if (prefs.strategy === "mix") {
    rules.push(`${STRATEGY_CHOICES.mix.label}, as you chose: no strategy on top.`);
  }
  const sleeve = prefs.cryptoSleeve === "off" ? null : prefs.cryptoSleeve;
  const sleeveShare = CRYPTO_SLEEVE_BY_LEVEL[level] ?? 0;
  const crypto =
    sleeve && sleeveShare > 0
      ? { strategy: sleeve, param: CRYPTO_EVIDENCE[sleeve].param, share: sleeveShare }
      : null;
  if (crypto) {
    rules.push(
      `A crypto sleeve (${CRYPTO_STRATEGIES[crypto.strategy].label}) of up to ${pct(crypto.share)} of the portfolio, beside the mix: ${CRYPTO_STRATEGIES[crypto.strategy].how}`,
    );
  } else if (sleeve) {
    rules.push(
      `The crypto sleeve you chose (${CRYPTO_STRATEGIES[sleeve].label}) waits: it runs at Very high only, and anything it held is sold.`,
    );
  }

  const dayRule = prefs.dayTrading === "off" ? null : prefs.dayTrading;
  const dayShare = INTRADAY_SLEEVE_BY_LEVEL[level] ?? 0;
  const dayTrade =
    dayRule && dayShare > 0
      ? { rule: dayRule, param: INTRADAY_EVIDENCE[dayRule].param, share: dayShare }
      : null;
  if (dayTrade) {
    rules.push(
      `Day trading (${INTRADAY_RULES[dayTrade.rule].label}) with up to ${pct(dayTrade.share)} of the portfolio, kept in cash for it: ${INTRADAY_RULES[dayTrade.rule].how} ${INTRADAY_WARNING}`,
    );
  } else if (dayRule) {
    rules.push(
      `The day trading you chose (${INTRADAY_RULES[dayRule].label}) waits: it runs at Very high only.`,
    );
  }

  const picked = prefs.catalogStrategy === "off" ? null : prefs.catalogStrategy;
  const verdict = picked ? CATALOG_EVIDENCE[picked]?.[level] : undefined;
  const catalog =
    picked &&
    verdict &&
    (verdict.watch || verdict.recommendable) &&
    CATALOG[picked].kind !== "sleeve"
      ? {
          id: picked,
          param: CATALOG[picked].grid[Math.floor((CATALOG[picked].grid.length - 1) / 2)],
        }
      : null;
  if (catalog) {
    rules.push(
      `Follows ${CATALOG[catalog.id].label} instead of the mix, as you chose: ${CATALOG[catalog.id].rules} ${verdict?.recommendable ? "Recommendable at this level." : "Worth watching at this level: it beat the mix in later years, but the edge may be luck."} Jane's extra moves wait meanwhile.`,
    );
  } else if (picked) {
    rules.push(
      `The tested strategy you chose (${CATALOG[picked].label}) waits: at ${RISK_LEVELS[level].label} the research doesn't rate it worth watching, so the mix runs.`,
    );
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
    limits,
    strategyChoice: prefs.strategy,
    universe: prefs.universe,
    crypto,
    dayTrade,
    catalog,
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
    excludedTickers: avoidedTickers(prefs.avoid, prefs.universe),
    taxSensitive: prefs.harvestLosses,
    cashBufferCents: prefs.cashBufferCents,
    mode: prefs.mode,
  };
}
