import {
  DROP_REACTIONS,
  GOALS,
  HORIZONS,
  MAX_AGE,
  MIN_AGE,
  PROFILE_QUESTIONS,
  PROFILE_REVIEW_DAYS,
  RISK_LEVELS,
  type DropReaction,
  type Goal,
  type Horizon,
  type ProfileQuestion,
  type ProfileQuestionKey,
  type RiskLevel,
} from "@/config/investing";

// What the person's investments are for (spec step 129), from their answers. Pure. Nothing
// is guessed: until all four questions are answered there's no risk level, and every later
// step that needs one asks first.

export type ProfileAnswers = {
  age: number | null;
  // YYYY-MM-DD: the day the age was given.
  ageOn: string | null;
  horizon: string | null;
  dropReaction: string | null;
  goals: string[];
  answeredAt: Date | null;
  // When any answer last changed: a year later, Jane checks it still fits.
  updatedAt: Date | null;
};

export const EMPTY_ANSWERS: ProfileAnswers = {
  age: null,
  ageOn: null,
  horizon: null,
  dropReaction: null,
  goals: [],
  answeredAt: null,
  updatedAt: null,
};

const isHorizon = (v: unknown): v is Horizon => typeof v === "string" && Object.hasOwn(HORIZONS, v);
const isDrop = (v: unknown): v is DropReaction =>
  typeof v === "string" && Object.hasOwn(DROP_REACTIONS, v);
const isGoal = (v: unknown): v is Goal => typeof v === "string" && Object.hasOwn(GOALS, v);

function answered(a: ProfileAnswers, key: ProfileQuestionKey): boolean {
  switch (key) {
    case "age":
      return a.age !== null;
    case "horizon":
      return isHorizon(a.horizon);
    case "drop":
      return isDrop(a.dropReaction);
    case "goal":
      return a.goals.some(isGoal);
  }
}

// The next question to ask, or null when all four are answered.
export function nextQuestion(a: ProfileAnswers): ProfileQuestion | null {
  return PROFILE_QUESTIONS.find((q) => !answered(a, q.key)) ?? null;
}

export const isComplete = (a: Omit<ProfileAnswers, "answeredAt" | "updatedAt">) =>
  PROFILE_QUESTIONS.every((q) => answered({ ...a, answeredAt: null, updatedAt: null }, q.key));

// The question after `key` in the usual order, for going through all four again.
export function questionAfter(key: string): ProfileQuestion | null {
  const index = PROFILE_QUESTIONS.findIndex((q) => q.key === key);
  return index < 0 ? null : (PROFILE_QUESTIONS[index + 1] ?? null);
}

// How many of the four are answered, for "2 of 4".
export const answeredCount = (a: ProfileAnswers) =>
  PROFILE_QUESTIONS.filter((q) => answered(a, q.key)).length;

// Age today, from the age given and when.
export function currentAge(a: Pick<ProfileAnswers, "age" | "ageOn">, asOf: string): number | null {
  if (a.age === null) return null;
  if (!a.ageOn) return a.age;
  const years = Math.floor((Date.parse(asOf) - Date.parse(a.ageOn)) / (365.25 * 86_400_000));
  return a.age + Math.max(0, years);
}

// The lower of what they can afford to risk and what they'd be comfortable with. Null until
// both are answered.
export function riskLevelOf(a: ProfileAnswers): RiskLevel | null {
  if (!isHorizon(a.horizon) || !isDrop(a.dropReaction)) return null;
  return Math.min(
    HORIZONS[a.horizon].capacity,
    DROP_REACTIONS[a.dropReaction].willingness,
  ) as RiskLevel;
}

export type ProfileSummary =
  | { complete: false; answered: number; next: ProfileQuestion }
  | {
      complete: true;
      riskLevel: RiskLevel;
      label: string;
      description: string;
      age: number;
      horizon: Horizon;
      goals: Goal[];
      // Why this level, in a sentence.
      why: string;
      // Asked a year or more ago: worth checking it still fits.
      stale: boolean;
    };

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function profileSummary(a: ProfileAnswers, asOf: string): ProfileSummary {
  const next = nextQuestion(a);
  const level = riskLevelOf(a);
  if (next || level === null || !isHorizon(a.horizon) || !isDrop(a.dropReaction)) {
    return { complete: false, answered: answeredCount(a), next: next ?? PROFILE_QUESTIONS[0] };
  }
  const capacity = HORIZONS[a.horizon].capacity;
  const willingness = DROP_REACTIONS[a.dropReaction].willingness;
  const need = `you need the money ${lower(HORIZONS[a.horizon].label)}`;
  const feel = `${lower(DROP_REACTIONS[a.dropReaction].label).replace(/^i'd/, "you'd")} after a drop`;
  const why =
    capacity === willingness
      ? `${RISK_LEVELS[level].label}: ${need}, and ${feel}.`
      : capacity < willingness
        ? `${RISK_LEVELS[level].label}: ${need}, so less risk than you'd be comfortable with.`
        : `${RISK_LEVELS[level].label}: ${feel}, so less risk than your timeline allows.`;
  return {
    complete: true,
    riskLevel: level,
    label: RISK_LEVELS[level].label,
    description: RISK_LEVELS[level].description,
    age: currentAge(a, asOf) ?? 0,
    horizon: a.horizon,
    goals: a.goals.filter(isGoal),
    why: why.charAt(0).toUpperCase() + why.slice(1),
    stale:
      a.updatedAt !== null &&
      Date.parse(asOf) - a.updatedAt.getTime() >= PROFILE_REVIEW_DAYS * 86_400_000,
  };
}

export class ProfileError extends Error {}

// One answer, checked: what to save. Ages are whole years in range; the rest are keys from
// src/config/investing.ts. A goal answer from the chat replaces the main goal.
export function parseAnswer(
  key: ProfileQuestionKey,
  value: string,
  asOf: string,
): Partial<ProfileAnswers> {
  const v = value.trim();
  switch (key) {
    case "age": {
      const age = Number(v);
      if (!/^\d{1,3}$/.test(v) || age < MIN_AGE || age > MAX_AGE) {
        throw new ProfileError(`Enter an age from ${MIN_AGE} to ${MAX_AGE}.`);
      }
      return { age, ageOn: asOf };
    }
    case "horizon":
      if (!isHorizon(v)) throw new ProfileError("Pick when you'll need the money.");
      return { horizon: v };
    case "drop":
      if (!isDrop(v)) throw new ProfileError("Pick what you'd do after a drop.");
      return { dropReaction: v };
    case "goal":
      if (!isGoal(v)) throw new ProfileError("Pick what the money is for.");
      return { goals: [v] };
  }
}

// The whole form from /investments/profile: every answer at once, goals as a list.
export function parseProfileForm(
  input: { age: string; horizon: string; dropReaction: string; goals: string[] },
  asOf: string,
): Omit<ProfileAnswers, "answeredAt" | "updatedAt"> {
  const goals = [...new Set(input.goals.map((g) => g.trim()))];
  if (goals.length === 0 || !goals.every(isGoal)) {
    throw new ProfileError("Pick at least one thing the money is for.");
  }
  return {
    ...(parseAnswer("age", input.age, asOf) as { age: number; ageOn: string }),
    horizon: parseAnswer("horizon", input.horizon, asOf).horizon!,
    dropReaction: parseAnswer("drop", input.dropReaction, asOf).dropReaction!,
    goals,
  };
}
