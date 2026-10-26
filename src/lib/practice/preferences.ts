import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { DEFAULT_LEVEL, STRATEGY_CHOICES } from "@/config/practice-preferences";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { profileOf } from "@/lib/investments/profile";
import { loadPrefs as loadValuesPrefs } from "@/lib/investments/values";
import { loadProfile } from "@/lib/profile";
import {
  applyPatch,
  DEFAULT_PREFERENCES,
  fromRow,
  type PracticePreferences,
  type PreferenceField,
  type PreferencePatch,
  type Validated,
} from "@/planning/practice-preferences";
import { practiceLevel } from "@/planning/practice-level";
import { profileFor, type PracticeProfile } from "@/planning/practice-profile";
import { MODEL_PORTFOLIOS, type PracticeClass } from "@/config/portfolios";
import { strategyToday } from "@/lib/investments/strategy-today";

// The person's practice-portfolio preferences (Phase AW, Stage A): read with the defaults filled
// in, and changed through the one check (applyPatch) from the settings page or the chat. Every
// change is audit-logged with where it came from. Scoped to the person. Practice money only.

type Options = { client?: PrismaClient; now?: Date };

// "sample": a sample person's settings, saved as their portfolio starts (./demo-start.ts).
export type ChangeSource = "page" | "chat" | "sample";

const SELECT = {
  riskLevel: true,
  maxDropPercent: true,
  goal: true,
  goalDate: true,
  monthlyAddCents: true,
  addDay: true,
  appetite: true,
  avoid: true,
  harvestLosses: true,
  cashBufferCents: true,
  mode: true,
  strategy: true,
  rebalancePace: true,
  universe: true,
  maxFundPercent: true,
  cryptoSleeve: true,
  dayTrading: true,
  catalogStrategy: true,
} as const;

export async function loadPreferences(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<PracticePreferences> {
  const row = await scopedFor(userId, client).practicePreferences.findFirst({ select: SELECT });
  if (row) return fromRow(row);
  // Until they choose here, what they leave out of their funds (step 236's values) is avoided.
  const values = await loadValuesPrefs(userId, { client });
  return { ...DEFAULT_PREFERENCES, avoid: [...values.excludes] };
}

// The questionnaire's level (step 288) from the investor profile's answers and how the person
// is paid, or null while the answers are incomplete.
export async function questionnaireLevel(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RiskLevel | null> {
  const answers = await profileOf(userId, { client });
  let stability: "steady" | "variable" | null = null;
  try {
    const pattern = (await loadProfile(userId, { client, now })).facts.income_pattern.value;
    if (pattern === "salary" || pattern === "pension") stability = "steady";
    if (pattern === "uneven" || pattern === "business") stability = "variable";
  } catch {
    // Without the profile the income counts as steady, as practiceLevel says.
  }
  const r = practiceLevel({
    horizon: answers.horizon,
    dropReaction: answers.dropReaction,
    stability,
    goals: answers.goals,
  });
  return r.complete ? r.level : null;
}

export type SaveResult =
  | (Validated & { ok: false })
  | {
      ok: true;
      before: PracticePreferences;
      preferences: PracticePreferences;
      changed: PreferenceField[];
    };

export async function savePreferences(
  userId: string,
  patch: PreferencePatch,
  source: ChangeSource,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<SaveResult> {
  const before = await loadPreferences(userId, { client });
  const result = applyPatch(before, patch, now.toISOString().slice(0, 10));
  if (!result.ok) return result;
  const { preferences: p, changed } = result;
  if (changed.length === 0) return { ok: true, before, preferences: p, changed };
  const data = {
    riskLevel: p.riskLevel,
    maxDropPercent: p.maxDropPercent,
    goal: p.goal,
    goalDate: p.goalDate ? new Date(`${p.goalDate}T00:00:00Z`) : null,
    monthlyAddCents: p.monthlyAddCents,
    addDay: p.addDay,
    appetite: p.appetite,
    avoid: p.avoid,
    harvestLosses: p.harvestLosses,
    cashBufferCents: p.cashBufferCents,
    mode: p.mode,
    strategy: p.strategy,
    rebalancePace: p.rebalancePace,
    universe: p.universe,
    maxFundPercent: p.maxFundPercent,
    cryptoSleeve: p.cryptoSleeve,
    dayTrading: p.dayTrading,
    catalogStrategy: p.catalogStrategy,
  };
  const db = scopedFor(userId, client);
  await db.practicePreferences.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { id: true },
  });
  // The portfolio keeps its own copy of the level and the monthly money (steps 290 and 291).
  await db.practicePortfolios.updateMany({
    data: {
      monthlyAddCents: p.monthlyAddCents,
      addDay: p.addDay,
      ...(p.riskLevel ? { level: p.riskLevel } : {}),
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "practice_preferences_changed",
    { type: "user", id: userId },
    { changed: changed.join(","), via: source, simulated: "true" },
  );
  await track(userId, "practice_preferences_changed", { changed: changed.join(","), via: source });
  return { ok: true, before, preferences: p, changed };
}

// The person's profile (src/planning/practice-profile.ts): the mix, caps and rules the autopilot,
// the scan and the backtests read. With no level chosen, the portfolio's, then the
// questionnaire's, then the middle level.
export async function practiceProfileOf(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PracticeProfile> {
  const prefs = await loadPreferences(userId, { client });
  let level = prefs.riskLevel;
  if (!level) {
    const portfolio = await scopedFor(userId, client).practicePortfolios.findFirst({
      select: { level: true },
    });
    level =
      portfolio && Object.hasOwn(RISK_LEVELS, portfolio.level)
        ? (portfolio.level as RiskLevel)
        : ((await questionnaireLevel(userId, { client, now })) ?? DEFAULT_LEVEL);
  }
  return withStrategy(profileFor(prefs, { level, today: now.toISOString().slice(0, 10) }), {
    client,
    now,
  });
}

// The level's chosen strategy, followed when the person's preferences leave the level's mix as
// it is (no goal-date glide path, nothing avoided that moves the mix): the month's strategy
// weights replace the mix's, and every hard limit and preference still applies to each trade.
async function withStrategy(profile: PracticeProfile, options: Options): Promise<PracticeProfile> {
  // The person chose the level's mix alone: no strategy on top.
  if (profile.strategyChoice === "mix") return profile;
  const choice = STRATEGY_CHOICES[profile.strategyChoice];
  // A strategy menu tilt (src/config/strategy-menu.ts): the level's mix, its US stocks part in
  // the tilt's fund.
  if ("fund" in choice) {
    const note = `${choice.label}, as you chose: your US stocks are held in ${choice.fund} instead of the whole market.`;
    return {
      ...profile,
      funds: { us_stocks: choice.fund },
      rules: [...profile.rules, note],
      strategy: {
        key: choice.fund,
        label: choice.label,
        why: choice.description,
        followed: true,
        note,
      },
    };
  }
  const today = await strategyToday(profile.level, {
    ...options,
    ...("id" in choice ? { pick: { id: choice.id, params: choice.params } } : {}),
  });
  if (!today) return profile;
  const whose =
    today.source === "person"
      ? "the strategy you chose"
      : "the level's choice from the daily replay";
  const model = MODEL_PORTFOLIOS[profile.level].weights;
  const untouched =
    !profile.glide &&
    (Object.keys(model) as PracticeClass[]).every(
      (c) => Math.abs(profile.weights[c] - model[c]) < 1e-9,
    );
  const followed = today.follow && untouched;
  const note = followed
    ? `This month the mix follows ${today.chosen.label.toLowerCase()} (${today.chosen.key}), ${whose}.`
    : today.follow
      ? `Your settings change the mix, so it stays as they set it rather than following ${whose}.`
      : today.why;
  return {
    ...profile,
    ...(followed && today.follow ? { weights: today.weights } : {}),
    rules: [...profile.rules, note],
    strategy: {
      key: today.chosen.key,
      label: today.chosen.label,
      why: today.chosen.why,
      followed,
      note,
    },
  };
}
