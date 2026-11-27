import type { TradeoffView } from "@/lib/goal-tradeoffs";
import { type GoalDate, type TradeOrder } from "@/planning/goal-tradeoffs";
import { pickGoalOrder } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { monthLabel } from "@/lib/day-label";
import { CARD } from "@/components/card";

// Goals that trade off openly (spec step 241): each order's dates from the year plan, Jane's
// suggested order and why, and the person's pick. Nothing re-plans without the tap.

const when = (d: GoalDate) =>
  d.month === null
    ? "not within ten years"
    : `${monthLabel(d.month, { long: true })}${d.lateMonths !== null && d.lateMonths > 0 ? `, ${d.lateMonths} month${d.lateMonths === 1 ? "" : "s"} late` : ", on time"}`;

// The saved order names every goal, the reached ones too; an option lists only the competing ones.
const same = (a: readonly string[] | null, b: TradeOrder) =>
  a !== null && a.filter((id) => b.order.includes(id)).join() === b.order.join();

export function GoalTradeoffs({ view }: { view: TradeoffView }) {
  if (!view.competing || !view.suggested) return null;
  // Four orders at most, but the person's own pick always stays in view.
  const shown = view.options.slice(0, 4);
  const mine = view.options.find((o) => same(view.chosen, o));
  const options = mine && !shown.includes(mine) ? [...shown.slice(0, 3), mine] : shown;
  return (
    <section id="tradeoffs" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">When your goals compete</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Your goals need more each month than your year plan has room for, so one waits for another.
        Here is when each is reached in each order.
      </p>
      <p className="rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
        <span className="font-semibold">Jane suggests:</span> {view.reason}
      </p>
      <ul className="flex flex-col gap-3">
        {options.map((o) => {
          const label = `${o.dates[0].name} first`;
          const picked = same(view.chosen, o);
          const suggested = o.order.join() === view.suggested?.order.join();
          return (
            <li key={o.order.join()} className={CARD}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  {label}
                  {suggested && <span className="ml-2 text-xs text-emerald-700">Suggested</span>}
                </h3>
                {picked ? (
                  <span className="text-sm text-emerald-700">Your order</span>
                ) : (
                  <form action={pickGoalOrder}>
                    <input type="hidden" name="order" value={o.order.join(",")} />
                    <SubmitButton className="rounded-full bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-800">
                      Use this order
                    </SubmitButton>
                  </form>
                )}
              </div>
              <ul className="text-sm">
                {o.dates.map((d) => (
                  <li key={d.id}>
                    {d.name}: {when(d)}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
