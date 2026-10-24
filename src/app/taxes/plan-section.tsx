import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { PlanMoveView, TaxPlanView } from "@/lib/tax-plan";
import { PlanButtons } from "./plan-buttons";

// The year-round tax plan on /taxes (spec step 167): each move by its deadline, whether
// it's on the deadlines, and one tap to put an open one there. Contribution, sale and gift
// moves are demo advice, labelled.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function PlanSection({ view, today }: { view: TaxPlanView; today: string }) {
  return (
    <section aria-labelledby="plan-heading" id="plan" className={CARD}>
      <h2 id="plan-heading" className="text-xl font-semibold">
        Your {view.year} tax plan
      </h2>
      {view.moves.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing left for {view.year}: every move&apos;s deadline has passed or doesn&apos;t apply
          to you.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {view.moves.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-1 border-t border-zinc-200 pt-3 text-sm first:border-0 first:pt-0 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{m.title}</h3>
                <span className="whitespace-nowrap">by {day(m.deadline)}</span>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">{m.detail}</p>
              <PlanMoveActions move={m} today={today} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// One move's state and its button, for the move's detail on the Taxes tree.
export function PlanMoveActions({ move: m, today }: { move: PlanMoveView; today: string }) {
  return (
    <>
      <p className="text-sm">
        {m.handled === "added"
          ? "On your deadlines."
          : m.handled === "no"
            ? "You said it's not for you."
            : m.opensOn > today
              ? `Jane brings it up on ${day(m.opensOn)}.`
              : "Open now."}
      </p>
      {m.handled === null && m.opensOn <= today && <PlanButtons moveId={m.id} label={m.title} />}
      {m.advice && <DemoAdviceLabel />}
    </>
  );
}
