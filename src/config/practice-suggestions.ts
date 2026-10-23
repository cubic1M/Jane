import type { ScanKind } from "@/config/practice-scan";
import type { SuggestionTopic } from "@/config/people";
import type { Urgency } from "@/detectors/contract";

// The practice scan's ideas as suggestions (Phase AW, Stage A): every flag the person is asked
// about (suggest-only mode, or a kind that only suggests) goes through the detectors and the
// nightly suggestion scan, ranked with everything else. Demo advice only: every topic here is
// in ADVICE_TOPICS, so a real account never gets one.

// The topic of each kind: one each, so what the person says to one kind moves that kind only.
// The autopilot's own rebalance is never asked about.
export const PRACTICE_TOPIC: Readonly<
  Record<Exclude<ScanKind, "drift_rebalance">, SuggestionTopic>
> = {
  dip_buy: "practice_dip_buy",
  tax_loss_harvest: "practice_tax_loss_harvest",
  news_idea: "practice_news_idea",
  new_money_rebalance: "practice_new_money",
  cash_drag: "practice_cash_drag",
  cheaper_fund: "practice_cheaper_fund",
  payday_timing: "practice_payday_timing",
  drift_warning: "practice_drift_warning",
  glide_path: "practice_glide_path",
  risk_mismatch: "practice_risk_mismatch",
  max_drop_near: "practice_max_drop_near",
};

// An idea waits this many days for the person; after that the next scan has newer numbers.
export const PRACTICE_IDEA_DAYS = 7;

// Practice money is sample money, so its dollars are small next to the person's real money.
// Each kind ranks as at least this many cents a year, so a practice idea can still reach the
// person (the budget is a few suggestions a day) without outranking real savings worth more.
// The safety kinds rank highest. FOR REVIEW with the founder.
export const PRACTICE_RANK_FLOOR_CENTS: Readonly<Record<keyof typeof PRACTICE_TOPIC, number>> = {
  dip_buy: 5_000,
  tax_loss_harvest: 8_000,
  news_idea: 3_000,
  new_money_rebalance: 8_000,
  cash_drag: 8_000,
  cheaper_fund: 5_000,
  payday_timing: 4_000,
  drift_warning: 10_000,
  glide_path: 15_000,
  risk_mismatch: 20_000,
  max_drop_near: 25_000,
};

export const PRACTICE_URGENCY: Readonly<Record<keyof typeof PRACTICE_TOPIC, Urgency>> = {
  dip_buy: "soon",
  tax_loss_harvest: "soon",
  news_idea: "later",
  new_money_rebalance: "soon",
  cash_drag: "soon",
  cheaper_fund: "later",
  payday_timing: "later",
  drift_warning: "soon",
  glide_path: "soon",
  risk_mismatch: "now",
  max_drop_near: "now",
};

// Where the buttons go: the practice page, and its settings page.
export const PRACTICE_HREF = "/investments/practice";
export const PRACTICE_SETTINGS_HREF = "/investments/practice/settings";

// A practice idea's suggestion key: "investing:<topic>:<the scan's key>", so each idea is its
// own suggestion (a no puts away that idea, not the kind) and its topic carries the history.
export const practiceIdeaId = (topic: string, opportunityKey: string) =>
  `investing:${topic}:${opportunityKey}`;

export function parsePracticeIdeaId(key: string): { topic: string; opportunityKey: string } | null {
  const m = /^investing:(practice_[a-z_]+):(.+)$/.exec(key);
  return m ? { topic: m[1], opportunityKey: m[2] } : null;
}
