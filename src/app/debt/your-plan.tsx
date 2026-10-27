import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { Payoff } from "@/lib/debt-plan";
import { formatCents, centsToInput } from "@/lib/money";
import type { PayoffPlan, Strategy } from "@/planning/debt";
import { monthAfter, monthName } from "@/planning/payoff";
import { startPlan, stopPlan } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// The payoff plan across every debt (spec step 110), above the planner: the same math,
// worked out from today's balances. In demo advice mode, Jane's pick and why (labelled);
// otherwise both orders as math. Starting a plan lets Jane check it every month.

const NAME: Record<Strategy, string> = {
  avalanche: "Highest rate first",
  snowball: "Smallest balance first",
};
const BUTTON = "h-11 rounded-full px-5 font-medium bg-emerald-700 text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-full border border-zinc-300 px-5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

function Outcome({ plan, asOf }: { plan: PayoffPlan; asOf: string }) {
  if (!plan.ok) {
    return <span>Doesn&apos;t finish at this amount</span>;
  }
  return (
    <span>
      Debt-free by {monthName(monthAfter(asOf, plan.months))},{" "}
      {formatCents(plan.totalInterestCents)} of interest
    </span>
  );
}

function StartButton({
  strategy,
  extraCents,
  label,
  primary,
}: {
  strategy: Strategy;
  extraCents: number;
  label: string;
  primary: boolean;
}) {
  return (
    <form action={startPlan}>
      <input type="hidden" name="strategy" value={strategy} />
      <input type="hidden" name="extra" value={centsToInput(extraCents)} />
      <SubmitButton className={primary ? BUTTON : SECONDARY}>{label}</SubmitButton>
    </form>
  );
}

export function YourPlan({
  payoff,
  asOf,
  saved,
  error,
}: {
  payoff: Payoff;
  asOf: string;
  saved: string;
  error: string;
}) {
  const { summary, stored, advice } = payoff;
  if (summary.cards.length === 0) return null;
  const pick = summary.pick;
  const first: Strategy = pick?.strategy ?? "avalanche";
  const order: Strategy[] = [first, first === "avalanche" ? "snowball" : "avalanche"];
  const isStored =
    stored &&
    stored.extraCents === summary.extraCents &&
    (!pick || stored.strategy === pick.strategy);

  return (
    <section
      id="plan"
      aria-labelledby="plan-title"
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="plan-title" className="text-xl font-semibold">
        Your way out of debt
      </h2>
      {saved && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          {saved === "started"
            ? "Started. Jane checks it every month and tells you if you fall behind."
            : "Stopped. Jane no longer checks a plan."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {error}
        </p>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Every loan, card and buy now, pay later plan Jane knows about, paying{" "}
        {formatCents(summary.minimumsCents + summary.extraCents)} a month (the minimums
        {summary.extraCents > 0 ? ` plus ${formatCents(summary.extraCents)} extra` : ""}). Worked
        out again from your balances every time you look.
      </p>

      {pick ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Jane&apos;s pick: {NAME[pick.strategy].toLowerCase()}</p>
          <ol className="list-decimal pl-5 text-sm">
            {pick.order.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ol>
          {pick.why.map((line) => (
            <p key={line} className="text-sm">
              {line}
            </p>
          ))}
          <p className="text-sm">
            <Outcome plan={summary[pick.strategy]} asOf={asOf} />.
          </p>
          <DemoAdviceLabel />
        </div>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {order.map((s) => (
            <div key={s}>
              <dt className="font-medium">{NAME[s]}</dt>
              <dd>
                <Outcome plan={summary[s]} asOf={asOf} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {summary.scenarios.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="text-left font-medium">Paying more each month</caption>
          <thead>
            <tr className="text-zinc-500">
              <th scope="col" className="py-1 font-normal">
                Extra a month
              </th>
              <th scope="col" className="py-1 font-normal">
                Debt-free by
              </th>
              <th scope="col" className="py-1 font-normal">
                Interest saved
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.scenarios.map((s) => (
              <tr key={s.extraCents} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1">{formatCents(s.extraCents)}</td>
                <td className="py-1">{monthName(monthAfter(asOf, s.months))}</td>
                <td className="py-1">
                  {s.interestSavedCents === null ? "–" : formatCents(s.interestSavedCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-zinc-500">
        {summary.savedAgainst === "minimums"
          ? "Interest saved is against paying only each debt's minimum."
          : `Interest saved is against paying ${formatCents(summary.minimumsCents + summary.extraCents)} a month as above: each debt's minimum on its own would never pay everything off.`}
      </p>
      {summary.leftOut.length > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Not included: {summary.leftOut.map((l) => l.name).join(", ")}.
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3" action="/debt#plan">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Extra a month ($)
          <input
            name="extra"
            inputMode="decimal"
            defaultValue={summary.extraCents ? centsToInput(summary.extraCents) : ""}
            className="h-11 w-40 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
          />
        </label>
        <button type="submit" className={SECONDARY}>
          Show it
        </button>
      </form>

      {isStored ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p>
            This is your plan ({NAME[stored.strategy].toLowerCase()}).{" "}
            {stored.status === "off_track"
              ? `At the last check you were behind: ${formatCents(stored.actualCents ?? 0)} owed against ${formatCents(stored.expectedCents ?? 0)} expected.`
              : stored.status === "on_track"
                ? "At the last check you were on track."
                : "Jane checks it every month."}
          </p>
          <form action={stopPlan}>
            <SubmitButton className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
              Stop the plan
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {order.map((s, i) => (
            <StartButton
              key={s}
              strategy={s}
              extraCents={summary.extraCents}
              primary={i === 0}
              label={
                pick
                  ? s === pick.strategy
                    ? "Start this plan"
                    : `Use ${NAME[s].toLowerCase()}`
                  : `Track ${NAME[s].toLowerCase()}`
              }
            />
          ))}
        </div>
      )}
      {!advice && <p className="text-xs text-zinc-500">This is math, not a recommendation.</p>}
    </section>
  );
}
