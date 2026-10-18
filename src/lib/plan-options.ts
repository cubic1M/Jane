import { PLAN_OPTIONS, type PlanOption } from "@/config/plan";
import type { ActionType } from "@/generated/prisma/client";

// The options a person picked on a plan item, checked against src/config/plan.ts. Amounts
// are stored in cents.
export type PlanOptions = Record<string, string | number>;

export class PlanOptionsError extends Error {}

// Reads options from form-like input. Unknown keys and empty amounts are dropped; anything
// out of range throws. Null when nothing differs from Jane's defaults.
export function parsePlanOptions(
  actionType: ActionType,
  input: Record<string, unknown>,
): PlanOptions | null {
  const out: PlanOptions = {};
  for (const option of PLAN_OPTIONS[actionType]) {
    const raw = input[option.key];
    if (raw === undefined || raw === null || raw === "") continue;
    out[option.key] = readOption(option, raw);
  }
  // The first choice of each choice option is the default; leaving all defaults is null.
  const differs = PLAN_OPTIONS[actionType].some((option) =>
    option.kind === "choice"
      ? out[option.key] !== undefined && out[option.key] !== option.choices[0].value
      : out[option.key] !== undefined,
  );
  return differs ? out : null;
}

function readOption(option: PlanOption, raw: unknown): string | number {
  if (option.kind === "choice") {
    if (typeof raw !== "string" || !option.choices.some((c) => c.value === raw)) {
      throw new PlanOptionsError(`Pick one of the choices for "${option.label}".`);
    }
    return raw;
  }
  const dollars = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(dollars) || dollars < option.min || dollars > option.max) {
    throw new PlanOptionsError(
      `"${option.label}" must be between $${option.min.toLocaleString("en-US")} and $${option.max.toLocaleString("en-US")}.`,
    );
  }
  return Math.round(dollars * 100);
}

// Plain words for the team and the timeline, e.g. "What to do: Switch to a cheaper plan".
export function describePlanOptions(actionType: ActionType, options: unknown): string[] {
  if (!options || typeof options !== "object") return [];
  const values = options as Record<string, unknown>;
  return PLAN_OPTIONS[actionType].flatMap((option) => {
    const value = values[option.key];
    if (value === undefined) return [];
    if (option.kind === "choice") {
      const choice = option.choices.find((c) => c.value === value);
      return choice ? [`${option.label}: ${choice.label}`] : [];
    }
    return typeof value === "number"
      ? [`${option.label.replace(/ \(\$\)$/, "")}: $${(value / 100).toLocaleString("en-US")}`]
      : [];
  });
}
