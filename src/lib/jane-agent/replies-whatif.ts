import { formatCents } from "@/lib/money";
import type { ScenarioRun } from "@/planning/what-if";
import type { Reply } from "./replies";

// What if (spec step 203) in the chat: one message with the cash picture first, then each
// sector's own line, then the plan with one button that adopts it. Adopting changes
// nothing by itself: the plan's changes become the next best things, and each still needs
// its usual tap.

export function whatIfReply(run: ScenarioRun | null): Reply {
  if (!run) {
    return {
      body: "Once your accounts are linked, I can run what-ifs through your real numbers: losing a job, a raise, a baby, a move, a car or a home.",
      actions: [],
      refs: {},
    };
  }
  const { sectors, params } = run;
  const lasts =
    params.months > 0 ? ` for ${params.months} ${params.months === 1 ? "month" : "months"}` : "";
  const lines = [
    `${run.label}${lasts}: ${sectors.forecast}`,
    `Without it, your lowest would be ${formatCents(run.before.lowestCents)}.`,
    sectors.debt,
    sectors.taxes,
    sectors.investing,
    run.sectors.goals.some((g) => g.status === "slips")
      ? `Goals that slip: ${run.sectors.goals
          .filter((g) => g.status === "slips")
          .map((g) => `"${g.name}"`)
          .join(", ")}.`
      : run.sectors.goals.length > 0
        ? "Your goals still fit."
        : null,
    run.plan.length > 0
      ? `My plan: ${run.plan
          .slice(0, 3)
          .map((c) => c.title)
          .join("; ")}.`
      : null,
    "This is a what-if from your own numbers; nothing has changed.",
  ].filter((l): l is string => Boolean(l));
  return {
    body: lines.join(" "),
    actions: [
      { id: "whatif.adopt", label: "Use this plan", kind: "primary" },
      { id: "open", label: "See the details", kind: "link", href: `/what-if?s=${run.scenario}` },
    ],
    refs: {
      whatIf: {
        scenario: run.scenario,
        months: run.params.months,
        extraMonthlyCents: run.params.extraMonthlyCents,
      },
    },
  };
}
