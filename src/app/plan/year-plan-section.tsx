import { SECTOR_LABELS } from "@/config/year-plan";
import { formatCents } from "@/lib/money";
import type { YearPlanView } from "@/lib/year-plan";

// The year's money plan (spec step 205) on /plan: twelve months, a past month as it was
// planned and how it went, the months ahead as they stand now.
const MUTED = "text-zinc-600 dark:text-zinc-400";
const name = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function YearPlanSection({ plan }: { plan: YearPlanView }) {
  const keys = Object.keys(SECTOR_LABELS) as (keyof typeof SECTOR_LABELS)[];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Your year</h2>
      <p className={MUTED}>
        Twelve months of targets that fit what comes in, re-planned each month from what really
        happened. A month that has passed doesn&apos;t change; what was missed moves into the months
        ahead.
      </p>
      <ul className="flex flex-col gap-2">
        {plan.months.map((m) => (
          <li
            key={m.month}
            className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          >
            <span className="font-semibold">
              {name(m.month)}
              {m.month === plan.currentMonth && " (this month)"}
              {m.trimmed && <span className={`font-normal ${MUTED}`}> · trimmed to fit</span>}
            </span>
            <span className={MUTED}>
              {keys
                .filter((k) => m.targets[k] > 0)
                .map((k) => {
                  const done =
                    m.actual && k in m.actual
                      ? ` (did ${formatCents(m.actual[k as "saving"])})`
                      : "";
                  return `${SECTOR_LABELS[k]} ${formatCents(m.targets[k])}${done}`;
                })
                .join(" · ") || "Nothing planned"}
            </span>
          </li>
        ))}
      </ul>
      <p className={`text-sm ${MUTED}`}>
        The year:{" "}
        {keys
          .filter((k) => plan.totals[k] > 0)
          .map((k) => `${SECTOR_LABELS[k]} ${formatCents(plan.totals[k])}`)
          .join(" · ")}
      </p>
    </section>
  );
}
