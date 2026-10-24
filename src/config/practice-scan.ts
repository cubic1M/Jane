// The daily scan of each practice portfolio (spec step 292, Phase AW, Stage A). Practice money
// and the sample market only: every number here is demo advice, FOR REVIEW before Stage B.
// The scan's rules are in src/planning/practice-scan.ts; nothing there has a number of its own.
// The kinds added after step 292 (./practice-opportunities.ts) are spread into each table here.

import type { RiskLevel } from "@/config/investing";
import {
  MAX_DROP_LOOKBACK_DAYS,
  OPPORTUNITY_CAPS,
  OPPORTUNITY_CONFIDENCE,
  OPPORTUNITY_KINDS,
  OPPORTUNITY_LABELS,
  type OpportunityKind,
} from "./practice-opportunities";

export type ScanKind =
  "drift_rebalance" | "dip_buy" | "tax_loss_harvest" | "news_idea" | OpportunityKind;

export const SCAN_KINDS: readonly ScanKind[] = [
  "drift_rebalance",
  "dip_buy",
  "tax_loss_harvest",
  "news_idea",
  ...OPPORTUNITY_KINDS,
];

// What each flag is called on a card and in the log.
export const SCAN_LABELS: Readonly<Record<ScanKind, string>> = {
  drift_rebalance: "Rebalance after drift",
  dip_buy: "Buy a dip, within the plan",
  tax_loss_harvest: "Harvest a loss",
  news_idea: "An idea from the news",
  ...OPPORTUNITY_LABELS,
};

// Per flag: the most one action may be, as a share of the portfolio's value (the size cap);
// the most of one holding it may leave (the per-position cap, as a share of the portfolio;
// the autopilot's own per-position caps apply too); and how many a calendar month may act.
export const SCAN_CAPS: Readonly<
  Record<ScanKind, { sizeShare: number; positionShare: number; perMonth: number }>
> = {
  // The rebalance itself is the autopilot's (AUTOPILOT_LIMITS); the scan only flags it.
  drift_rebalance: { sizeShare: 0.7, positionShare: 0.8, perMonth: 4 },
  dip_buy: { sizeShare: 0.05, positionShare: 0.8, perMonth: 2 },
  tax_loss_harvest: { sizeShare: 0.7, positionShare: 0.8, perMonth: 2 },
  news_idea: { sizeShare: 0.01, positionShare: 0.03, perMonth: 2 },
  ...OPPORTUNITY_CAPS,
};

// Drift: the share in stocks (US and international together) this many points off its target
// counts as drift, as well as any one kind past the autopilot's band (AUTOPILOT_LIMITS).
export const DRIFT_STOCKS_BAND = 0.05;

// A dip: a model holding's close at least this far below its highest close of the last
// DIP_LOOKBACK_DAYS trading days. The sample market's ordinary swings stay under it through
// 2026; the planted dips go past it.
export const DIP_MIN_DROP = 0.1;
export const DIP_LOOKBACK_DAYS = 20;
// The calendar days of closes the scan reads: enough to hold the dip's and the max drop's
// look-backs in trading days.
export const SCAN_HISTORY_DAYS = Math.max(DIP_LOOKBACK_DAYS, MAX_DROP_LOOKBACK_DAYS) * 2 + 10;
// The plan's cash for a dip is cash waiting to be invested (the monthly practice money before
// the autopilot spends it). A dip buy never takes its kind past target plus this many points.
export const DIP_MAX_OVER_TARGET = 0.05;

// A loss worth harvesting: at least this share of what the holding cost, and at least step
// 124's HARVEST_MIN_LOSS_CENTS. The swap is into a similar fund of the same kind (so the mix
// stays as it is), and never one bought or sold at a loss within WASH_SALE_DAYS (a wash sale).
export const HARVEST_MIN_LOSS_SHARE = 0.08;

// News-driven ideas look at the watched companies' headlines from the last few days, at High
// and Very high only (OPPORTUNITY_LEVELS), and only when opportunities aren't paused. A
// headline counts as good news when it matches this; a headline that also matches the bad-news
// pattern doesn't count. Rules on the headline's own words: no forecast, no price target.
export const NEWS_LOOKBACK_DAYS = 2;
export const NEWS_GOOD =
  /\b(?:ahead of supply|better-than-expected|beats?|record (?:sales|demand)|jumps?|new .*investment)\b/i;
export const NEWS_BAD =
  /\b(?:recalls?|cuts? (?:its )?outlook|fewer|miss(?:es)?|slip|falls?|lawsuit|probe)\b/i;
// All opportunity stocks together are never more than this share of the portfolio.
export const OPPORTUNITY_MAX_SHARE = 0.05;

// How sure Jane is about each kind, and why: a fixed rule reads higher than one headline.
export const SCAN_CONFIDENCE: Readonly<Record<ScanKind, { percent: number; reason: string }>> = {
  drift_rebalance: {
    percent: 90,
    reason: "A fixed rule: it puts the mix back where your level says, whatever prices do next.",
  },
  dip_buy: {
    percent: 60,
    reason:
      "It buys more of what the plan already holds, with cash waiting anyway; a dip can deepen before it recovers.",
  },
  tax_loss_harvest: {
    percent: 75,
    reason:
      "The loss is there today and the swap keeps the mix; what it's worth depends on your taxes, and this is practice money.",
  },
  news_idea: {
    percent: 35,
    reason: "One headline is thin evidence, so the position is kept small.",
  },
  ...OPPORTUNITY_CONFIDENCE,
};

// The opportunity rules: everything the scan does beyond the autopilot's own rebalance.
export type OpportunityRule = Exclude<ScanKind, "drift_rebalance">;
// The ones that trade, so a replay can say whether they helped. The rest only suggest or warn
// (ADVICE_ONLY_KINDS in src/planning/practice-opportunities.ts), so a replay can't judge them.
export const OPPORTUNITY_RULES: readonly OpportunityRule[] = [
  "dip_buy",
  "tax_loss_harvest",
  "news_idea",
  "new_money_rebalance",
  "cash_drag",
  "cheaper_fund",
];

// Rules turned off at a level because the rule replay (src/planning/rule-replay.ts, "Did the
// extra rules help?") found they made results worse on real history there: with the rule, the
// replay's time-weighted return was lower, or its worst drop deeper, than without it by more than
// RULE_REPLAY_WORSE_POINTS (src/config/backtest.ts). Each entry keeps its evidence: the history it
// was replayed on and the two figures. A rule comes back on only with new evidence. FOR REVIEW.
//
// The replay of October 22, 2026: real adjusted daily closes for all eleven tickers from Jan 4,
// 2016 to Oct 14, 2026 (2,711 trading days; Yahoo Finance's adjusted closes, standing in for the
// stored Alpaca history, which this replay couldn't read), $10,000 to start, $500 every month, a
// 2-basis-point cost a trade. What it found:
// - Dip buys: helped at Very low (+0.45 points of return) and High (+0.85); within 0.25 points
//   elsewhere. Kept on everywhere.
// - Tax-loss swaps: within 0.25 points at Very low (-0.01) and Low (-0.23); worse at Medium,
//   High and Very high, so turned off there. Re-run the same day after swaps became watched
//   daily (#483): still worse, by a little less. Re-run again once everyday buys went to each
//   kind's own fund and the swap partner only for the wash-sale window (buyFundFor): at Medium
//   and Very high still a little worse on both counts; at High 0.18 points more return with a
//   deeper worst drop, well under the 1% gain (RULE_TUNE_MIN_GAIN) a rule needs to be kept, so
//   it stays off (below). The replay is before tax: the harvested losses would lower a real tax
//   bill, which it doesn't count. Worth another look with a tax model before Stage B.
// - New money, idle cash and cheaper twin funds (#483): no difference at any level (0.00 to
//   +0.01 points): the autopilot would have invested the same cash the same day. Kept on.
// - News ideas: not replayed. Headlines are stored only since step 293 (October 2026), so there
//   is no past news to replay; they stay on at High and Very high, untested, at 1% a position.
export type RuleOff = { rule: OpportunityRule; evidence: string };
// `returnPoints` is the replay with swaps less the replay without them (negative: less return),
// `dropPoints` how much deeper its worst drop was.
const HARVEST_OFF = (returnPoints: number, dropPoints: number): RuleOff => ({
  rule: "tax_loss_harvest",
  evidence: `on real history from Jan 4, 2016 to Oct 14, 2026, the replay with tax-loss swaps returned ${Math.abs(returnPoints).toFixed(2)} points ${returnPoints < 0 ? "less" : "more"}, with a worst drop ${dropPoints.toFixed(2)} points deeper, than the same replay without them (before tax)${returnPoints < 0 ? "" : ": not the gain a rule needs to be kept"}.`,
});
export const OPPORTUNITY_RULES_OFF: Readonly<Partial<Record<RiskLevel, readonly RuleOff[]>>> = {
  3: [HARVEST_OFF(-0.01, 0.03)],
  4: [HARVEST_OFF(0.18, 0.04)],
  5: [HARVEST_OFF(-0.04, 0.05)],
};

// The scan kinds that may flag at a level: drift always, and each opportunity rule not turned off.
export function rulesOnAt(level: RiskLevel): Set<ScanKind> {
  const off = new Set((OPPORTUNITY_RULES_OFF[level] ?? []).map((r) => r.rule));
  return new Set(SCAN_KINDS.filter((k) => !off.has(k as OpportunityRule)));
}
