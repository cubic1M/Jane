import { formatCents } from "@/lib/money";
import type { MoneyForTwoView } from "@/lib/money-for-two";
import { sharesWords } from "@/planning/money-for-two";
import { answerBigMove, chooseBigMove, chooseSplit, shareGoal } from "./actions";

const CARD =
  "flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800";
const BUTTON =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Money for two (spec step 242): how bills split, joint goals, big moves that need both taps.
// Only what either partner shared; the partner's income is never shown, only the shares.
export function MoneyForTwo({
  view,
  myGoals,
}: {
  view: MoneyForTwoView;
  myGoals: { id: string; name: string; sharedWithHousehold: boolean }[];
}) {
  const waiting = view.bigMoves.filter((m) => !m.mine);
  const mineWaiting = view.bigMoves.filter((m) => m.mine);
  return (
    <section className={CARD} id="money-for-two">
      <h2 className="font-semibold">Money for two</h2>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">How shared bills split</h3>
        <p className="text-sm">
          {view.rule === "income"
            ? `By income: you ${Math.round(view.myShareBps / 100)}%, ${view.partnerName} ${100 - Math.round(view.myShareBps / 100)}%.`
            : `Half each. By income it would be ${sharesWords(view.incomeMyShareBps)} (you first).`}
        </p>
        <form action={chooseSplit} className="flex flex-wrap gap-2">
          <button type="submit" name="rule" value="even" className={BUTTON}>
            Half each
          </button>
          <button type="submit" name="rule" value="income" className={BUTTON}>
            By income
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Big moves need both of you</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A move of {formatCents(view.bigMoveCents)} or more out of a shared account waits for the
          other&apos;s tap.
        </p>
        <form action={chooseBigMove} className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="big-move">From</label>
          <input
            id="big-move"
            name="amount"
            inputMode="decimal"
            defaultValue={String(view.bigMoveCents / 100)}
            className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button type="submit" className={BUTTON}>
            Save
          </button>
        </form>
        {waiting.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {view.partnerName} wants to move {formatCents(m.amountCents)} to {m.toName} on{" "}
              {m.runOn}.
            </span>
            <form action={answerBigMove} className="flex gap-2">
              <input type="hidden" name="transferId" value={m.id} />
              <button type="submit" name="answer" value="approve" className={BUTTON}>
                Approve
              </button>
              <button type="submit" name="answer" value="decline" className={BUTTON}>
                Decline
              </button>
            </form>
          </div>
        ))}
        {mineWaiting.map((m) => (
          <p key={m.id} className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatCents(m.amountCents)} to {m.toName} waits for {view.partnerName}&apos;s tap.
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Joint goals</h3>
        {view.jointGoals.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            None yet. Make one of your goals joint and {view.partnerName} sees it too.
          </p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {view.jointGoals.map((g) => (
            <li key={g.id}>
              {g.name}: {formatCents(g.savedCents)} of {formatCents(g.targetCents)} by{" "}
              {g.targetDate}
              {!g.mine && <span className="text-zinc-500"> · {view.partnerName}&apos;s</span>}
            </li>
          ))}
        </ul>
        {myGoals.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {myGoals.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span>{g.name}</span>
                <form action={shareGoal}>
                  <input type="hidden" name="goalId" value={g.id} />
                  <input type="hidden" name="shared" value={String(!g.sharedWithHousehold)} />
                  <button type="submit" className={BUTTON}>
                    {g.sharedWithHousehold ? "Make it mine only" : "Make it joint"}
                    <span className="sr-only"> {g.name}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
