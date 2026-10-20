import {
  HARDSHIP_DEFAULT,
  HARDSHIP_PROGRAMS,
  LEAN_MAX_WAITABLE,
  UNEMPLOYMENT_DIRECTORY,
  UNEMPLOYMENT_STEPS,
} from "@/config/lean-plan";
import { formatCents } from "@/lib/money";

// When income stops (spec step 204). Pure: the cash, the forecast's bills and the debts in,
// the lean plan out: how long the cash lasts, bills that can wait, a hardship option for each
// loan and card, and the unemployment guide for the person's state.

export type LeanInput = {
  cashCents: number;
  // The person's average monthly spending.
  monthlySpendingCents: number;
  // Bills the forecast expects over the next 30 days.
  forecastBillsCents: number;
  waitable: { name: string; monthlyCents: number }[];
  debts: { name: string; kind: string }[];
  stateName: string | null;
};

export type LeanPlan = {
  // What goes out each month while it lasts: the larger of average spending and the
  // forecast's bills.
  outflowCents: number;
  runwayMonths: number | null;
  waitable: { name: string; monthlyCents: number }[];
  waitableCents: number;
  runwayWithoutWaitMonths: number | null;
  hardship: { debt: string; program: string; ask: string }[];
  unemployment: { intro: string; steps: readonly string[]; directory: string };
};

const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toString();

export function leanPlan(input: LeanInput): LeanPlan {
  const outflow = Math.max(input.monthlySpendingCents, input.forecastBillsCents);
  const waitable = [...input.waitable]
    .sort((a, b) => b.monthlyCents - a.monthlyCents || a.name.localeCompare(b.name))
    .slice(0, LEAN_MAX_WAITABLE);
  const waitableCents = waitable.reduce((s, w) => s + w.monthlyCents, 0);
  const runway = (out: number) =>
    out <= 0 ? null : Math.max(0, Math.round((input.cashCents / out) * 10) / 10);
  return {
    outflowCents: outflow,
    runwayMonths: runway(outflow),
    waitable,
    waitableCents,
    runwayWithoutWaitMonths: runway(Math.max(0, outflow - waitableCents)),
    hardship: input.debts.map((d) => {
      const program = HARDSHIP_PROGRAMS[d.kind] ?? HARDSHIP_DEFAULT;
      return { debt: d.name, program: program.name, ask: program.ask };
    }),
    unemployment: {
      intro: input.stateName
        ? `To file in ${input.stateName}, search "${input.stateName} unemployment insurance" or use the federal directory.`
        : "Your state's unemployment office is found through the federal directory.",
      steps: UNEMPLOYMENT_STEPS,
      directory: UNEMPLOYMENT_DIRECTORY,
    },
  };
}

// The one message, in plain words.
export function leanMessage(plan: LeanPlan): string {
  const lines = [
    plan.runwayMonths === null
      ? "I can't work out how long your cash lasts yet."
      : `Your cash covers about ${oneDecimal(plan.runwayMonths)} months at ${formatCents(plan.outflowCents)} a month.`,
  ];
  if (plan.waitable.length > 0) {
    lines.push(
      `These could wait or be paused: ${plan.waitable.map((w) => `${w.name} (${formatCents(w.monthlyCents)})`).join(", ")}. That adds about ${oneDecimal(
        (plan.runwayWithoutWaitMonths ?? 0) - (plan.runwayMonths ?? 0),
      )} months.`,
    );
  }
  if (plan.hardship.length > 0) {
    lines.push(
      `For your debts: ${plan.hardship.map((h) => `${h.debt}: ${h.program}. ${h.ask}`).join(" ")}`,
    );
  }
  lines.push(`${plan.unemployment.intro} ${plan.unemployment.steps.join(" ")}`);
  return lines.join(" ");
}
