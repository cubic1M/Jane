import { DROP_REACTIONS, GOALS, HORIZONS, RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { MODEL_PORTFOLIOS, STABILITY_PENALTY, type ModelPortfolio } from "@/config/portfolios";

// The practice portfolio's risk level (spec step 288): from the horizon, the reaction to a 20%
// drop, how steady the income is and what the money is for. The lower of what the person can
// afford (the horizon, less a level for uneven income) and what they would stand (the reaction)
// wins, and money for a near-term goal keeps it down. Pure: the same answers always give the
// same level.

export type PracticeAnswers = {
  horizon: string | null;
  dropReaction: string | null;
  // "steady" for a salary or pension; "variable" for uneven or business income; null if unknown
  // (treated as steady, and said so).
  stability: "steady" | "variable" | null;
  goals: readonly string[];
};

export type PracticeLevel =
  | { complete: false }
  | {
      complete: true;
      level: RiskLevel;
      label: string;
      reason: string;
      portfolio: ModelPortfolio;
    };

const clamp = (n: number): RiskLevel => Math.min(5, Math.max(1, Math.round(n))) as RiskLevel;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function practiceLevel(a: PracticeAnswers): PracticeLevel {
  if (!a.horizon || !Object.hasOwn(HORIZONS, a.horizon)) return { complete: false };
  if (!a.dropReaction || !Object.hasOwn(DROP_REACTIONS, a.dropReaction)) return { complete: false };
  const horizon = HORIZONS[a.horizon as keyof typeof HORIZONS];
  const drop = DROP_REACTIONS[a.dropReaction as keyof typeof DROP_REACTIONS];
  const penalty = STABILITY_PENALTY[a.stability ?? "steady"];
  const capacity = clamp(horizon.capacity - penalty);
  const willingness = drop.willingness;
  // Money for a home or a child's school soon is kept to the middle at most.
  const nearGoal =
    (a.goals.includes("home") || a.goals.includes("education")) &&
    (a.horizon === "under_3" || a.horizon === "3_to_10");
  const cap = nearGoal ? 3 : 5;
  const level = clamp(Math.min(capacity, willingness, cap));
  const why: string[] = [];
  why.push(`you need the money ${lower(horizon.label)}`);
  if (penalty > 0) why.push("your income moves around, which lowers what you can risk by a level");
  why.push(`after a 20% drop you'd say: ${lower(drop.label)}`);
  if (nearGoal) {
    const goal = a.goals.includes("home") ? GOALS.home : GOALS.education;
    why.push(`${lower(goal)} comes up soon, which keeps it at Medium or below`);
  }
  const binding =
    level === willingness && willingness < capacity
      ? "less risk than your timeline allows"
      : level === capacity && capacity < willingness
        ? "less risk than you'd be comfortable with"
        : "your timeline and your comfort agree";
  return {
    complete: true,
    level,
    label: RISK_LEVELS[level].label,
    reason: `${RISK_LEVELS[level].label}: ${why.join("; ")}, so ${binding}.`,
    portfolio: MODEL_PORTFOLIOS[level],
  };
}
