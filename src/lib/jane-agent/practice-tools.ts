import type Anthropic from "@anthropic-ai/sdk";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { CRYPTO_SLEEVE_BY_LEVEL } from "@/config/crypto-strategies";
import { CATALOG_EVIDENCE } from "@/config/catalog-evidence";
import { CATALOG, CATALOG_IDS } from "@/config/strategy-catalog";
import { GOALS, RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  APPETITES,
  AUTOPILOT_MODES,
  CRYPTO_SLEEVE_CHOICES,
  DAY_TRADING_CHOICES,
  BROAD_FUND_NOTE,
  EXCLUSIONS,
  MAX_FUND_RANGE,
  REBALANCE_PACES,
  STRATEGY_CHOICES,
  UNIVERSES,
} from "@/config/practice-preferences";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import type { ToolOutput } from "@/lib/ask/tools";
import { dollarFigures } from "@/lib/guardrails";
import { loadPreferences, practiceProfileOf } from "@/lib/practice/preferences";
import { scopedFor } from "@/lib/db-scoped";
import {
  applyPatch,
  avoidKey,
  describeChanges,
  PREFERENCE_FIELDS,
  PREFERENCE_LABELS,
  sayPreference,
  type PreferencePatch,
} from "@/planning/practice-preferences";
import type { MessageAction, MessageRefs } from "./types";

// The practice portfolio's settings in Jane's chat (Phase AW, Stage A). practice_settings reads
// them; change_practice_settings turns "make it less risky", "stop the extra moves", "avoid oil
// companies" or "I need this money in 2030" into a change, checked by the same rules as the
// settings page (applyPatch), and puts it under the answer as a card. Nothing changes until the
// person taps it (practice.prefs_save), which saves through savePreferences and the audit log.
// Practice money and demo advice only.

export const PRACTICE_SETTINGS_PATH = "/investments/practice/settings";
export const CHANGE_PRACTICE_TOOL = "change_practice_settings";

const LEVEL_LABELS = Object.values(RISK_LEVELS).map((l) => l.label);

export const PRACTICE_TOOLS: Anthropic.Tool[] = [
  {
    name: "practice_settings",
    description:
      "The person's practice (paper money) portfolio settings and what they make the autopilot do: risk level, the largest drop they can live with, goal and date, monthly practice money and its day, extra moves (off, cautious, normal, adventurous), what is never bought, loss harvesting, cash kept, suggest-only or act, the strategy it follows (Jane's pick for the level, the level's mix alone, the trend filter or the volatility target), how often it rebalances, whether it may buy company shares or funds only, and the most in one fund. Demo advice mode only. Read it before changing a setting.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: CHANGE_PRACTICE_TOOL,
    description:
      'Prepare a change to the practice portfolio settings as a card the person confirms with a tap; nothing changes until they do. Give only what they asked to change. "Make it less risky" is risk_step lower; "stop the extra moves" is extra_moves off; "avoid oil companies" is avoid_add fossil_fuels; "I need this money in 2030" is goal_date 2030-01-01; "just tell me first" is mode suggest; "use the trend strategy" is strategy trend, "no strategy, just the mix" is strategy mix, "go back to your pick" is strategy level; "use the value tilt" (or momentum, quality, dividend growth, equal weight) is strategy value_tilt (momentum_tilt, quality_tilt, dividend_growth, equal_weight); sector rotation and all-weather are not in the practice portfolio yet, so say so; "trade less often" is rebalance_pace rarely; "only index funds" or "no single stocks" is universe funds_only; "never more than half in one fund" is max_fund_percent 50; "add the crypto trend" (or crypto held, crypto momentum) is crypto_sleeve crypto_trend (crypto_hold, crypto_momentum), only at Very high, and "no crypto" is crypto_sleeve off; day trading is not offered (every rule tested lost money after costs), so say so, and "stop day trading" is day_trading off; "follow HAA" (or any tested strategy on the worth-watching or recommendable lists of strategy_menu) is catalog_strategy with its id, and "back to my mix" is catalog_strategy off. After calling it, write one sentence on what will change once they confirm; never say it is done. Demo advice mode only.',
    input_schema: {
      type: "object" as const,
      properties: {
        risk_level: { type: "string", enum: [...LEVEL_LABELS, "from my answers"] },
        risk_step: { type: "string", enum: ["lower", "higher"] },
        max_drop_percent: {
          type: ["integer", "null"],
          description: "The largest drop they can live with, in whole percent; null for none.",
        },
        goal: { type: "string", enum: Object.keys(GOALS) },
        goal_date: { type: "string", description: "YYYY, YYYY-MM or YYYY-MM-DD." },
        clear_goal: { type: "boolean" },
        monthly_amount: { type: "number", description: "Dollars a month of practice money." },
        add_day: { type: "integer", description: "Day of the month, 1 to 28." },
        extra_moves: { type: "string", enum: Object.keys(APPETITES) },
        avoid_add: {
          type: "array",
          items: { type: "string" },
          description: `Groups (${Object.keys(EXCLUSIONS).join(", ")}) or tickers never to buy.`,
        },
        avoid_remove: { type: "array", items: { type: "string" } },
        harvest_losses: { type: "boolean" },
        cash_buffer: { type: "number", description: "Dollars always kept in cash." },
        mode: { type: "string", enum: Object.keys(AUTOPILOT_MODES) },
        strategy: { type: "string", enum: Object.keys(STRATEGY_CHOICES) },
        rebalance_pace: { type: "string", enum: Object.keys(REBALANCE_PACES) },
        universe: { type: "string", enum: Object.keys(UNIVERSES) },
        max_fund_percent: {
          type: ["integer", "null"],
          description: `The most of the portfolio in one fund, ${MAX_FUND_RANGE.min} to ${MAX_FUND_RANGE.max} whole percent; null for the limit.`,
        },
        crypto_sleeve: {
          type: "string",
          enum: Object.keys(CRYPTO_SLEEVE_CHOICES),
          description: "The crypto sleeve beside the mix (Very high only), or off.",
        },
        day_trading: {
          type: "string",
          enum: Object.keys(DAY_TRADING_CHOICES),
          description: "The day-trading sleeve's rule (Very high only), or off.",
        },
        catalog_strategy: {
          type: "string",
          enum: ["off", ...CATALOG_IDS],
          description:
            "A tested strategy to follow instead of the mix (only one worth watching or recommendable at the level), or off.",
        },
      },
      additionalProperties: false,
    },
  },
];

export const isPracticeTool = (name: string) => PRACTICE_TOOLS.some((t) => t.name === name);

export const PRACTICE_NOT_IN_ADVICE =
  "The practice portfolio runs on sample data for demo accounts only. This person's accounts are real, so there are no practice settings.";

type Options = { client: PrismaClient; now: Date };

const cents = (dollars: unknown) =>
  typeof dollars === "number" && Number.isFinite(dollars) ? Math.round(dollars * 100) : dollars;

function goalDay(raw: string): string {
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  return raw;
}

// The tool's input as a change to the preferences, with relative changes ("one lower", "add
// oil") made absolute from where they stand. Unknown values pass through for applyPatch to
// refuse.
export async function patchFromInput(
  userId: string,
  input: unknown,
  { client, now }: Options,
): Promise<PreferencePatch> {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const current = await loadPreferences(userId, { client });
  const patch: PreferencePatch = {};
  if (typeof a.risk_level === "string") {
    const level = Object.entries(RISK_LEVELS).find(([, l]) => l.label === a.risk_level)?.[0];
    patch.riskLevel =
      a.risk_level === "from my answers" ? null : level ? Number(level) : a.risk_level;
  } else if (a.risk_step === "lower" || a.risk_step === "higher") {
    const from = (await practiceProfileOf(userId, { client, now })).level;
    const to = from + (a.risk_step === "lower" ? -1 : 1);
    patch.riskLevel = Math.min(5, Math.max(1, to)) as RiskLevel;
  }
  if ("max_drop_percent" in a) patch.maxDropPercent = a.max_drop_percent;
  if (a.clear_goal === true) patch.goal = null;
  if ("goal" in a) patch.goal = a.goal;
  if (typeof a.goal_date === "string") patch.goalDate = goalDay(a.goal_date.trim());
  if ("monthly_amount" in a) patch.monthlyAddCents = cents(a.monthly_amount);
  if ("add_day" in a) patch.addDay = a.add_day;
  if ("extra_moves" in a) patch.appetite = a.extra_moves;
  if (Array.isArray(a.avoid_add) || Array.isArray(a.avoid_remove)) {
    const add = Array.isArray(a.avoid_add) ? a.avoid_add.map(String) : [];
    const remove = new Set(
      (Array.isArray(a.avoid_remove) ? a.avoid_remove.map(String) : []).map(
        (r) => avoidKey(r) ?? r,
      ),
    );
    patch.avoid = [...current.avoid, ...add].filter((k) => !remove.has(avoidKey(k) ?? k));
  }
  if ("harvest_losses" in a) patch.harvestLosses = a.harvest_losses;
  if ("cash_buffer" in a) patch.cashBufferCents = cents(a.cash_buffer);
  if ("mode" in a) patch.mode = a.mode;
  if ("strategy" in a) patch.strategy = a.strategy;
  if ("rebalance_pace" in a) patch.rebalancePace = a.rebalance_pace;
  if ("universe" in a) patch.universe = a.universe;
  if ("max_fund_percent" in a) patch.maxFundPercent = a.max_fund_percent;
  if ("crypto_sleeve" in a) patch.cryptoSleeve = a.crypto_sleeve;
  if ("day_trading" in a) patch.dayTrading = a.day_trading;
  if ("catalog_strategy" in a) patch.catalogStrategy = a.catalog_strategy;
  return patch;
}

export type PracticeProposal =
  | { ok: true; actions: MessageAction[]; refs: MessageRefs; line: string; cents: number[] }
  | { ok: false; error: string };

// The card for a change: what it changes, in words, and the button that makes it. The same check
// as the page; nothing is saved here.
export async function proposePracticeChange(
  userId: string,
  input: unknown,
  { client, now }: Options,
): Promise<PracticeProposal> {
  if (!(await adviceMode(userId, { client }))) return { ok: false, error: PRACTICE_NOT_IN_ADVICE };
  const patch = await patchFromInput(userId, input, { client, now });
  const before = await loadPreferences(userId, { client });
  const result = applyPatch(before, patch, now.toISOString().slice(0, 10));
  if (!result.ok) return { ok: false, error: Object.values(result.errors).join(" ") };
  if (result.changed.length === 0) {
    return { ok: false, error: "Those settings are already set that way; nothing to change." };
  }
  if (result.changed.includes("cryptoSleeve") && result.preferences.cryptoSleeve !== "off") {
    const level =
      result.preferences.riskLevel ?? (await practiceProfileOf(userId, { client, now })).level;
    if (CRYPTO_SLEEVE_BY_LEVEL[level] === undefined)
      return { ok: false, error: "The crypto sleeve runs at Very high only." };
  }
  if (result.changed.includes("dayTrading") && result.preferences.dayTrading !== "off") {
    // Every rule lost money after costs (src/config/intraday-evidence.ts): not offered.
    return {
      ok: false,
      error:
        "Day trading isn't offered: every day-trading rule we tested lost money after costs, while simply holding SPY made far more.",
    };
  }
  if (result.changed.includes("catalogStrategy") && result.preferences.catalogStrategy !== "off") {
    const level =
      result.preferences.riskLevel ?? (await practiceProfileOf(userId, { client, now })).level;
    const e = CATALOG_EVIDENCE[result.preferences.catalogStrategy]?.[level];
    if (!e || !(e.watch || e.recommendable))
      return {
        ok: false,
        error: `At this level the research doesn't rate ${CATALOG[result.preferences.catalogStrategy].label} worth watching, so the practice portfolio won't follow it.`,
      };
  }
  const lines = describeChanges(before, result.preferences, result.changed);
  const extra =
    result.changed.includes("avoid") && result.preferences.avoid.some((k) => k in EXCLUSIONS)
      ? `\n${BROAD_FUND_NOTE}`
      : "";
  const line = `Change your practice settings:\n${lines.map((l) => `- ${l}`).join("\n")}${extra}`;
  const practicePrefs = Object.fromEntries(
    result.changed.map((f) => [f, result.preferences[f]]),
  ) as MessageRefs["practicePrefs"];
  return {
    ok: true,
    actions: [
      { id: "practice.prefs_save", label: "Make the change", kind: "primary" },
      { id: "open", label: "See practice settings", kind: "link", href: PRACTICE_SETTINGS_PATH },
    ],
    refs: { practicePrefs },
    line,
    cents: dollarFigures(line).map((f) => f.cents),
  };
}

export async function runPracticeTool(
  userId: string,
  name: string,
  _input: unknown,
  { client, now }: Options,
): Promise<ToolOutput> {
  if (name !== "practice_settings")
    return { content: JSON.stringify({ error: "unknown tool" }), cents: [] };
  if (!(await adviceMode(userId, { client }))) {
    return { content: JSON.stringify({ note: PRACTICE_NOT_IN_ADVICE }), cents: [] };
  }
  const prefs = await loadPreferences(userId, { client });
  const profile = await practiceProfileOf(userId, { client, now });
  const started = await scopedFor(userId, client).practicePortfolios.findFirst({
    select: { paused: true },
  });
  const settings = Object.fromEntries(
    PREFERENCE_FIELDS.map((f) => [PREFERENCE_LABELS[f], sayPreference(prefs, f)]),
  );
  const content = JSON.stringify({
    label: DEMO_ADVICE_LABEL,
    practice: "Paper money only; nothing real is traded.",
    portfolio: started ? (started.paused ? "started, paused" : "started") : "not started yet",
    settings,
    level_used: RISK_LEVELS[profile.level].label,
    what_the_autopilot_does: profile.rules,
    page: PRACTICE_SETTINGS_PATH,
  });
  return { content, cents: dollarFigures(content).map((f) => f.cents) };
}
