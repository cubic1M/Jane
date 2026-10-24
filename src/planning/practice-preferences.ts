import { GOALS, RISK_LEVELS, type Goal, type RiskLevel } from "@/config/investing";
import { PRACTICE_UNIVERSE } from "@/config/portfolios";
import {
  ADD_DAY_RANGE,
  APPETITES,
  CRYPTO_SLEEVE_CHOICES,
  DAY_TRADING_CHOICES,
  type CryptoSleeveChoice,
  type DayTradingChoice,
  AUTOPILOT_MODES,
  AVOID_MAX,
  CASH_BUFFER_MAX_CENTS,
  EXCLUSIONS,
  GOAL_MAX_YEARS,
  MAX_DROP_RANGE,
  MAX_FUND_RANGE,
  REBALANCE_PACES,
  STRATEGY_CHOICES,
  UNIVERSES,
  type RebalancePace,
  type StrategyChoice,
  type Universe,
  MONTHLY_ADD_MAX_CENTS,
  PREFERENCE_DEFAULTS,
  type Appetite,
  type AutopilotMode,
} from "@/config/practice-preferences";

// What the person wants from the practice portfolio (Phase AW, Stage A), and the one check every
// change goes through, from the settings page and from the chat alike. Pure. Practice money only.

export type PracticePreferences = {
  // Null follows the questionnaire's level (step 288).
  riskLevel: RiskLevel | null;
  // The largest drop they can live with, in whole percent; null for no limit beyond the level.
  maxDropPercent: number | null;
  goal: Goal | null;
  // When the money is needed, YYYY-MM-DD.
  goalDate: string | null;
  monthlyAddCents: number;
  addDay: number;
  appetite: Appetite;
  // Exclusion keys (EXCLUSIONS) and tickers, never bought.
  avoid: string[];
  harvestLosses: boolean;
  cashBufferCents: number;
  mode: AutopilotMode;
  // The strategy followed (STRATEGY_CHOICES), how far a kind drifts before a rebalance, what may
  // be bought, and the most of the portfolio one fund may be (whole percent; null for the hard
  // limit).
  strategy: StrategyChoice;
  rebalancePace: RebalancePace;
  universe: Universe;
  maxFundPercent: number | null;
  // The crypto sleeve (CRYPTO_SLEEVE_CHOICES), followed at Very high only.
  cryptoSleeve: CryptoSleeveChoice;
  // The day-trading sleeve (DAY_TRADING_CHOICES), followed at Very high only.
  dayTrading: DayTradingChoice;
};

export type PreferenceField = keyof PracticePreferences;
export type PreferencePatch = { [K in PreferenceField]?: unknown };

export const PREFERENCE_FIELDS: readonly PreferenceField[] = [
  "riskLevel",
  "maxDropPercent",
  "goal",
  "goalDate",
  "monthlyAddCents",
  "addDay",
  "appetite",
  "avoid",
  "harvestLosses",
  "cashBufferCents",
  "mode",
  "strategy",
  "rebalancePace",
  "universe",
  "maxFundPercent",
  "cryptoSleeve",
  "dayTrading",
];

export const DEFAULT_PREFERENCES: PracticePreferences = {
  riskLevel: null,
  ...PREFERENCE_DEFAULTS,
  avoid: [],
};

export type Validated =
  | { ok: true; preferences: PracticePreferences; changed: PreferenceField[] }
  | { ok: false; errors: Partial<Record<PreferenceField, string>> };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// An exclusion key or a ticker the practice portfolio could buy, as stored; null if neither.
export function avoidKey(raw: string): string | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (Object.hasOwn(EXCLUSIONS, key)) return key;
  const ticker = raw.trim().toUpperCase();
  return PRACTICE_UNIVERSE.has(ticker) ? ticker : null;
}

function check(
  field: PreferenceField,
  v: unknown,
  today: string,
): { value: unknown } | { error: string } {
  switch (field) {
    case "riskLevel":
      if (v === null) return { value: null };
      return isInt(v) && Object.hasOwn(RISK_LEVELS, v)
        ? { value: v }
        : { error: "Pick a level from Very low to Very high." };
    case "maxDropPercent":
      if (v === null) return { value: null };
      return isInt(v) && v >= MAX_DROP_RANGE.min && v <= MAX_DROP_RANGE.max
        ? { value: v }
        : { error: `Pick a drop between ${MAX_DROP_RANGE.min}% and ${MAX_DROP_RANGE.max}%.` };
    case "goal":
      if (v === null) return { value: null };
      return typeof v === "string" && Object.hasOwn(GOALS, v)
        ? { value: v }
        : { error: "Pick one of the goals." };
    case "goalDate": {
      if (v === null) return { value: null };
      if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
        return { error: "Give the date as a day, month and year." };
      const latest = `${Number(today.slice(0, 4)) + GOAL_MAX_YEARS}${today.slice(4)}`;
      if (v <= today) return { error: "The goal date needs to be in the future." };
      if (v > latest) return { error: `Pick a date within ${GOAL_MAX_YEARS} years.` };
      return { value: v };
    }
    case "monthlyAddCents":
      return isInt(v) && v >= 0 && v <= MONTHLY_ADD_MAX_CENTS
        ? { value: v }
        : { error: `Pick a monthly amount from $0 to $${MONTHLY_ADD_MAX_CENTS / 100}.` };
    case "addDay":
      return isInt(v) && v >= ADD_DAY_RANGE.min && v <= ADD_DAY_RANGE.max
        ? { value: v }
        : { error: `Pick a day from ${ADD_DAY_RANGE.min} to ${ADD_DAY_RANGE.max}.` };
    case "appetite":
      return typeof v === "string" && Object.hasOwn(APPETITES, v)
        ? { value: v }
        : { error: "Pick off, cautious, normal or adventurous." };
    case "avoid": {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
        return { error: "List what to avoid." };
      const keys: string[] = [];
      for (const raw of v as string[]) {
        const key = avoidKey(raw);
        if (!key) return { error: `Jane doesn't know "${raw.slice(0, 40)}" to avoid.` };
        if (!keys.includes(key)) keys.push(key);
      }
      if (keys.length > AVOID_MAX) return { error: `At most ${AVOID_MAX} things to avoid.` };
      return { value: keys };
    }
    case "harvestLosses":
      return typeof v === "boolean" ? { value: v } : { error: "Say yes or no." };
    case "cashBufferCents":
      return isInt(v) && v >= 0 && v <= CASH_BUFFER_MAX_CENTS
        ? { value: v }
        : { error: `Pick an amount from $0 to $${CASH_BUFFER_MAX_CENTS / 100}.` };
    case "mode":
      return typeof v === "string" && Object.hasOwn(AUTOPILOT_MODES, v)
        ? { value: v }
        : { error: "Pick suggest only or act within the limits." };
    case "strategy":
      return typeof v === "string" && Object.hasOwn(STRATEGY_CHOICES, v)
        ? { value: v }
        : {
            error: "Pick Jane's pick, the level's mix, the trend filter or the volatility target.",
          };
    case "rebalancePace":
      return typeof v === "string" && Object.hasOwn(REBALANCE_PACES, v)
        ? { value: v }
        : { error: "Pick often, normal or rarely." };
    case "universe":
      return typeof v === "string" && Object.hasOwn(UNIVERSES, v)
        ? { value: v }
        : { error: "Pick funds only, or funds and a few big companies." };
    case "maxFundPercent":
      if (v === null) return { value: null };
      return isInt(v) && v >= MAX_FUND_RANGE.min && v <= MAX_FUND_RANGE.max
        ? { value: v }
        : { error: `Pick a share from ${MAX_FUND_RANGE.min}% to ${MAX_FUND_RANGE.max}%.` };
    case "cryptoSleeve":
      return typeof v === "string" && Object.hasOwn(CRYPTO_SLEEVE_CHOICES, v)
        ? { value: v }
        : { error: "Pick off, crypto held, the crypto trend or crypto momentum." };
    case "dayTrading":
      return typeof v === "string" && Object.hasOwn(DAY_TRADING_CHOICES, v)
        ? { value: v }
        : { error: "Pick off or one of the day-trading rules." };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The one check for every change: unknown fields and bad values are refused whole (nothing is
// half-saved); a goal date without a goal is fine, and clearing the goal clears its date.
export function applyPatch(
  current: PracticePreferences,
  patch: PreferencePatch,
  today: string,
): Validated {
  const errors: Partial<Record<PreferenceField, string>> = {};
  const next = { ...current, avoid: [...current.avoid] } as Record<PreferenceField, unknown>;
  for (const [field, value] of Object.entries(patch)) {
    if (!(PREFERENCE_FIELDS as readonly string[]).includes(field)) {
      errors[field as PreferenceField] = "Jane doesn't have that setting.";
      continue;
    }
    if (value === undefined) continue;
    const r = check(field as PreferenceField, value, today);
    if ("error" in r) errors[field as PreferenceField] = r.error;
    else next[field as PreferenceField] = r.value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (patch.goal === null && patch.goalDate === undefined) next.goalDate = null;
  const preferences = next as PracticePreferences;
  const changed = PREFERENCE_FIELDS.filter((f) => !same(current[f], preferences[f]));
  return { ok: true, preferences, changed };
}

// A saved row (the database's shape) as preferences; anything unreadable falls back to its
// default, so an old or hand-edited row never stops the autopilot.
export function fromRow(row: {
  riskLevel: number | null;
  maxDropPercent: number | null;
  goal: string | null;
  goalDate: Date | null;
  monthlyAddCents: number;
  addDay: number;
  appetite: string;
  avoid: string[];
  harvestLosses: boolean;
  cashBufferCents: number;
  mode: string;
  strategy: string;
  rebalancePace: string;
  universe: string;
  maxFundPercent: number | null;
  cryptoSleeve: string;
  dayTrading: string;
}): PracticePreferences {
  const d = DEFAULT_PREFERENCES;
  return {
    riskLevel:
      row.riskLevel !== null && Object.hasOwn(RISK_LEVELS, row.riskLevel)
        ? (row.riskLevel as RiskLevel)
        : null,
    maxDropPercent: row.maxDropPercent,
    goal: row.goal !== null && Object.hasOwn(GOALS, row.goal) ? (row.goal as Goal) : null,
    goalDate: row.goalDate ? row.goalDate.toISOString().slice(0, 10) : null,
    monthlyAddCents: row.monthlyAddCents,
    addDay: row.addDay,
    appetite: Object.hasOwn(APPETITES, row.appetite) ? (row.appetite as Appetite) : d.appetite,
    avoid: row.avoid.map(avoidKey).filter((k): k is string => k !== null),
    harvestLosses: row.harvestLosses,
    cashBufferCents: row.cashBufferCents,
    mode: Object.hasOwn(AUTOPILOT_MODES, row.mode) ? (row.mode as AutopilotMode) : d.mode,
    strategy: Object.hasOwn(STRATEGY_CHOICES, row.strategy)
      ? (row.strategy as StrategyChoice)
      : d.strategy,
    rebalancePace: Object.hasOwn(REBALANCE_PACES, row.rebalancePace)
      ? (row.rebalancePace as RebalancePace)
      : d.rebalancePace,
    universe: Object.hasOwn(UNIVERSES, row.universe) ? (row.universe as Universe) : d.universe,
    maxFundPercent:
      row.maxFundPercent !== null &&
      row.maxFundPercent >= MAX_FUND_RANGE.min &&
      row.maxFundPercent <= MAX_FUND_RANGE.max
        ? row.maxFundPercent
        : null,
    cryptoSleeve: Object.hasOwn(CRYPTO_SLEEVE_CHOICES, row.cryptoSleeve)
      ? (row.cryptoSleeve as CryptoSleeveChoice)
      : d.cryptoSleeve,
    dayTrading: Object.hasOwn(DAY_TRADING_CHOICES, row.dayTrading)
      ? (row.dayTrading as DayTradingChoice)
      : d.dayTrading,
  };
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function avoidLabel(key: string): string {
  return Object.hasOwn(EXCLUSIONS, key) ? EXCLUSIONS[key as keyof typeof EXCLUSIONS].label : key;
}

const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// One field in plain words, for the page, the confirmation card and the chat.
export function sayPreference(p: PracticePreferences, field: PreferenceField): string {
  switch (field) {
    case "riskLevel":
      return p.riskLevel ? RISK_LEVELS[p.riskLevel].label : "From your answers";
    case "maxDropPercent":
      return p.maxDropPercent === null ? "No limit beyond your level" : `${p.maxDropPercent}%`;
    case "goal":
      return p.goal ? GOALS[p.goal] : "None";
    case "goalDate":
      return p.goalDate ? longDay(p.goalDate) : "None";
    case "monthlyAddCents":
      return dollars(p.monthlyAddCents);
    case "addDay":
      return `Day ${p.addDay}`;
    case "appetite":
      return APPETITES[p.appetite].label;
    case "avoid":
      return p.avoid.length === 0 ? "Nothing" : p.avoid.map(avoidLabel).join(", ");
    case "harvestLosses":
      return p.harvestLosses ? "Yes" : "No";
    case "cashBufferCents":
      return dollars(p.cashBufferCents);
    case "mode":
      return AUTOPILOT_MODES[p.mode].label;
    case "strategy":
      return STRATEGY_CHOICES[p.strategy].label;
    case "rebalancePace":
      return REBALANCE_PACES[p.rebalancePace].label;
    case "universe":
      return UNIVERSES[p.universe].label;
    case "maxFundPercent":
      return p.maxFundPercent === null
        ? `${MAX_FUND_RANGE.max}% (the limit)`
        : `${p.maxFundPercent}%`;
    case "cryptoSleeve":
      return CRYPTO_SLEEVE_CHOICES[p.cryptoSleeve].label;
    case "dayTrading":
      return DAY_TRADING_CHOICES[p.dayTrading].label;
  }
}

export const PREFERENCE_LABELS: Readonly<Record<PreferenceField, string>> = {
  riskLevel: "Risk level",
  maxDropPercent: "Largest drop you can live with",
  goal: "Goal",
  goalDate: "When you need the money",
  monthlyAddCents: "Monthly practice money",
  addDay: "Day it goes in",
  appetite: "Extra moves",
  avoid: "Never buy",
  harvestLosses: "Harvest losses for taxes",
  cashBufferCents: "Cash to keep",
  mode: "Autopilot",
  strategy: "Strategy",
  rebalancePace: "How often to rebalance",
  universe: "What Jane may buy",
  maxFundPercent: "Most in one fund",
  cryptoSleeve: "Crypto sleeve (Very high only)",
  dayTrading: "Day trading (Very high only)",
};

// What a change does, one line per field: "Risk level: Medium → Low".
export function describeChanges(
  before: PracticePreferences,
  after: PracticePreferences,
  changed: readonly PreferenceField[],
): string[] {
  return changed.map(
    (f) => `${PREFERENCE_LABELS[f]}: ${sayPreference(before, f)} → ${sayPreference(after, f)}`,
  );
}

type FormLike = { get(name: string): unknown; getAll(name: string): unknown[] };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (text(v) === "" ? Number.NaN : Number(text(v).replace(/[$,]/g, "")));
const dollarsToCents = (v: unknown) => {
  const n = num(v);
  return Number.isFinite(n) ? Math.round(n * 100) : n;
};

// The settings page's form as a change, every field at once; applyPatch does the checking.
// Empty means "none" where a field can be none (level, drop, goal, date).
export function parsePreferenceForm(form: FormLike): PreferencePatch {
  const level = text(form.get("riskLevel"));
  const drop = text(form.get("maxDropPercent"));
  const fund = text(form.get("maxFundPercent"));
  const tickers = text(form.get("avoidTickers"))
    .split(/[\s,]+/)
    .filter(Boolean);
  return {
    riskLevel: level === "" ? null : Number(level),
    maxDropPercent: drop === "" ? null : num(drop),
    goal: text(form.get("goal")) || null,
    goalDate: text(form.get("goalDate")) || null,
    monthlyAddCents: dollarsToCents(form.get("monthlyAdd")),
    addDay: num(form.get("addDay")),
    appetite: text(form.get("appetite")),
    avoid: [...form.getAll("avoid").map(text).filter(Boolean), ...tickers],
    harvestLosses: form.get("harvestLosses") === "on",
    cashBufferCents: dollarsToCents(form.get("cashBuffer")),
    mode: text(form.get("mode")),
    strategy: text(form.get("strategy")),
    rebalancePace: text(form.get("rebalancePace")),
    universe: text(form.get("universe")),
    maxFundPercent: fund === "" ? null : num(fund),
    // Only when the form has it (the page shows it at Very high).
    ...(form.get("cryptoSleeve") == null ? {} : { cryptoSleeve: text(form.get("cryptoSleeve")) }),
    ...(form.get("dayTrading") == null ? {} : { dayTrading: text(form.get("dayTrading")) }),
  };
}
