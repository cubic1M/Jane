import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { SCAN_LABELS, SCAN_KINDS, type ScanKind } from "@/config/practice-scan";
import { formatReturn } from "@/insights/returns";
import { BACKTEST_NOT_A_FORECAST } from "@/config/backtest";
import type { Backtests } from "@/lib/investments/backtest";
import type { LatestStrategies } from "@/lib/investments/strategy-eval";
import { keyOf } from "@/planning/strategies/select";
import {
  STRATEGY_LABELS,
  STRATEGY_NOT_A_FORECAST,
  STRATEGY_RESEARCH_CHOICE,
} from "@/config/strategies";
import type { LoadedRuleReplays, RuleVerdict } from "@/lib/investments/rule-replay";
import { formatCents } from "@/lib/money";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";

// Jane's rule answers about the practice portfolio (spec step 297, Phase AW, Stage A): what she
// bought and sold this week and why, the pause switch, and how a level would have done in a
// past year. Pure: the numbers in, the words out. Practice money and sample data only; every
// answer is demo advice, and none of it is a forecast.

const PRACTICE: MessageAction = {
  id: "open",
  label: "See the trade log",
  kind: "link",
  href: "/investments/practice",
};
export const PAUSE: MessageAction = {
  id: "open",
  label: "Pause switch",
  kind: "link",
  href: "/investments/practice#pause",
};
const BACKTESTS: MessageAction = {
  id: "open",
  label: "See every level",
  kind: "link",
  href: "/investments#backtests-heading",
};

export const PRACTICE_ONLY_NOTE =
  "The practice portfolio is demo advice, for the demo bank's sample people only, so I can't run one on your real accounts.";

export const RULE_LABELS: Readonly<Record<string, string>> = {
  model_buy: "buying the model for your level",
  rebalance: "rebalancing back to your mix",
  strategy_switch: "moving into the fund of the strategy you chose",
  ...Object.fromEntries(SCAN_KINDS.map((k) => [k, SCAN_LABELS[k as ScanKind].toLowerCase()])),
};
const MAX_LINES = 4;
const MAX_CHARS = 680;

export type PracticeTradeRow = {
  placedAt: Date;
  side: string;
  ticker: string | null;
  amountCents: number;
  reason: string;
  rule: string;
};

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const day = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// "What did you buy this week and why": the week's practice trades, newest first, each with
// the rule that allowed it and the first one's reason in full.
export function practiceLogReply(
  practice: { level: RiskLevel; paused: boolean } | null,
  trades: readonly PracticeTradeRow[],
  advice: boolean,
  // "Why?": every trade with its reason, as many as fit.
  explain = false,
): Reply {
  if (!advice) return { body: PRACTICE_ONLY_NOTE, actions: [], refs: {} };
  if (!practice) {
    return {
      body: "I haven't bought anything: you don't have a practice portfolio yet. Start one and I'll buy the model for your level with practice money, nothing real.",
      actions: [{ ...PRACTICE, label: "Start with practice money" }],
      refs: { advice: true },
    };
  }
  const placed = trades.filter((t) => t.side === "buy" || t.side === "sell");
  const paused = practice.paused ? " It's paused now, so nothing more until you resume." : "";
  if (placed.length === 0) {
    return {
      body: `Nothing this week: your ${RISK_LEVELS[practice.level].label} practice portfolio was on target.${paused}`,
      actions: [PRACTICE],
      refs: { advice: true },
    };
  }
  const bought = placed.filter((t) => t.side === "buy").reduce((s, t) => s + t.amountCents, 0);
  const sold = placed.filter((t) => t.side === "sell").reduce((s, t) => s + t.amountCents, 0);
  const n = placed.length;
  const head = `This week I bought ${formatCents(bought)} and sold ${formatCents(sold)} in your practice portfolio, in ${n} trade${n === 1 ? "" : "s"}, with practice money only.`;
  const lines = placed.map((t, i) => {
    const what = `${t.side === "buy" ? "bought" : "sold"} ${formatCents(t.amountCents)} of ${t.ticker}`;
    const rule = RULE_LABELS[t.rule] ?? t.rule;
    return i === 0 || explain
      ? `- ${day(t.placedAt)}: ${what}. ${t.reason}`
      : `- ${day(t.placedAt)}: ${what} (${rule}).`;
  });
  let shown = lines.slice(0, MAX_LINES);
  const text = () => {
    const left = n - shown.length;
    const more = left > 0 ? `\nAnd ${left} more in the trade log, each with its reason.` : "";
    return `${head}\n${shown.join("\n")}${more}${paused}`;
  };
  while (shown.length > 1 && text().length > MAX_CHARS) shown = shown.slice(0, -1);
  return { body: text(), actions: [PRACTICE, PAUSE], refs: { advice: true } };
}

const WHAT = {
  all: "your practice portfolio",
  opportunities: "opportunities in your practice portfolio",
} as const;

// "Pause it" / "resume it": the practice portfolio's switch, set from the chat.
export function practicePauseReply(
  outcome: "paused" | "resumed" | "already_paused" | "already_running" | "none",
  which: "all" | "opportunities",
  advice: boolean,
): Reply {
  if (!advice) return { body: PRACTICE_ONLY_NOTE, actions: [], refs: {} };
  const what = WHAT[which];
  const bodies: Record<typeof outcome, string> = {
    paused:
      which === "all"
        ? `Paused ${what}. I won't trade there until you resume; it takes effect before the next daily scan.`
        : `Paused ${what}. I'll only keep the model on target until you resume.`,
    resumed: `Resumed ${what}. The next daily scan picks up from here.`,
    already_paused: `${what[0].toUpperCase()}${what.slice(1)} is already paused. Say "resume it" when you want me back.`,
    already_running: `${what[0].toUpperCase()}${what.slice(1)} is already running.`,
    none: 'There\'s no practice portfolio to pause. To stop me acting on your money, say "pause the autopilot".',
  };
  return {
    body: bodies[outcome],
    actions: outcome === "none" ? [{ ...PRACTICE, label: "Practice portfolio" }] : [PAUSE],
    refs: { advice: true },
  };
}

// "How would a High portfolio have done in 2022": step 295's replay, never a forecast.
export function backtestReply(
  data: { advice: false } | { advice: true; backtests: Backtests },
  level: RiskLevel | null,
  year: number | null,
): Reply {
  if (!data.advice) {
    return {
      body: "Replays of the model portfolios are demo advice, for the demo bank's sample people only, so I can't show them for your real accounts.",
      actions: [],
      refs: {},
    };
  }
  const b = data.backtests;
  const chosen = b.levels.filter((l) => level === null || l.level === level);
  if (chosen.length === 0) {
    return { body: "I don't have a replay for that level.", actions: [BACKTESTS], refs: {} };
  }
  const lines = chosen.map((l) => {
    const r = l.result;
    const y = year === null ? null : r.years.find((x) => x.year === year);
    if (y) {
      return `A ${l.label} portfolio in ${year}: ${formatCents(y.startCents)} became ${formatCents(y.endCents)} (${formatReturn(y.return)}), with a worst fall of ${formatReturn(y.worstDrop)} inside the year.`;
    }
    return `A ${l.label} portfolio from ${longDate(b.from)} to ${longDate(b.to)}: ${formatCents(r.startCents)} became ${formatCents(r.endCents)} (${formatReturn(r.totalReturn)}), with a worst fall of ${formatReturn(r.worstDrop.fraction)}.`;
  });
  const missing = year !== null && !chosen.some((l) => l.result.years.some((x) => x.year === year));
  const lead = missing ? `The replay doesn't cover ${year}, so here is all of it. ` : "";
  return {
    body: `${lead}${lines.join("\n")}\n${b.label}, with fund costs and rebalancing, no taxes. ${b.notAForecast}`,
    actions: [BACKTESTS],
    refs: { advice: true },
  };
}

const STRATEGIES: MessageAction = {
  id: "open",
  label: "See every level",
  kind: "link",
  href: "/investments#level-strategies-heading",
};

// "Which strategy does my level use": the daily replay's choice for the level, and why.
export function levelStrategyReply(
  advice: boolean,
  latest: LatestStrategies | null,
  level: RiskLevel,
  own: boolean,
): Reply {
  if (!advice)
    return {
      body: "The practice strategies are demo advice, for the demo bank's sample people only, so I can't show them for your real accounts.",
      actions: [],
      refs: {},
    };
  const name = own ? `Your level, ${RISK_LEVELS[level].label},` : RISK_LEVELS[level].label;
  const research = STRATEGY_RESEARCH_CHOICE[level];
  const c = latest?.byLevel[level] ?? {
    id: research.id,
    key: keyOf({ id: research.id, params: research.params }),
    label: STRATEGY_LABELS[research.id],
    why: research.why,
  };
  return {
    body: `${name} follows ${c.id === "static" ? "its mix" : `the ${c.label.toLowerCase()} (${c.key})`}. ${c.why}\n${STRATEGY_NOT_A_FORECAST}`,
    actions: [STRATEGIES],
    refs: { advice: true },
  };
}
const RULE_REPLAY: MessageAction = {
  id: "open",
  label: "See every level",
  kind: "link",
  href: "/investments#rule-replay-heading",
};

// "Did the extra rules help?": for one level (the person's own unless they named one), the
// autopilot with its rules against plain rebalancing and buy and hold, then each rule's verdict.
export function ruleReplayReply(
  data: { advice: false } | { advice: true; data: LoadedRuleReplays | null },
  level: RiskLevel,
  own: boolean,
): Reply {
  if (!data.advice) {
    return {
      body: "Replays of the autopilot's rules are demo advice, for the demo bank's sample people only, so I can't show them for your real accounts.",
      actions: [],
      refs: {},
    };
  }
  const l = data.data?.replays.levels.find((x) => x.level === level);
  if (!data.data || !l) {
    return { body: "I don't have a replay of the rules for that level.", actions: [], refs: {} };
  }
  const name = RISK_LEVELS[level].label;
  const s = l.strategies;
  const gap = (s.rules.totalReturn - s.rebalance.totalReturn) * 100;
  const against =
    Math.abs(gap) < 0.05
      ? "level with plain rebalancing"
      : `${Math.abs(gap).toFixed(1)} points ${gap > 0 ? "ahead of" : "behind"} plain rebalancing`;
  // The rules grouped by what they did, in a few words each.
  const group = (status: RuleVerdict["status"]) =>
    l.verdicts.filter((v) => v.status === status).map((v) => v.label.toLowerCase());
  const groups = (
    [
      ["Helped", group("helped")],
      ["Made it worse", group("hurt")],
      ["Turned off here, as worse on real prices", group("off")],
      ["No real difference", group("no_difference")],
      ["Not replayed", group("not_replayed")],
    ] as const
  )
    .filter(([, rules]) => rules.length > 0)
    .map(([label, rules]) => `${label}: ${rules.join("; ")}.`);
  const d = data.data;
  return {
    body: [
      `${own ? `Your level, ${name}` : name}: the autopilot with its extra rules came out ${against}, ${formatReturn(s.rules.totalReturn)} against ${formatReturn(s.rebalance.totalReturn)}.`,
      `Buy and hold made ${formatReturn(s.hold.totalReturn)}, with a ${s.hold.worstDrop < s.rules.worstDrop ? "deeper" : "shallower"} worst drop (${formatReturn(s.hold.worstDrop)} against ${formatReturn(s.rules.worstDrop)}).`,
      groups.join(" "),
      `${d.label}, ${formatCents(d.replays.assumptions.monthlyAddCents)} a month. ${BACKTEST_NOT_A_FORECAST}`,
    ].join("\n"),
    actions: [RULE_REPLAY],
    refs: { advice: true },
  };
}
