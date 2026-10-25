import { LONG_GAME_SOURCES, PSLF_PAYMENTS } from "@/config/student-loans";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { LongGame } from "@/lib/student-long-game";
import { saveDates } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// The long game on student loans (spec step 225): PSLF month by month, the dates that become
// deadlines, the tax on forgiven debt, and what refinancing would give up.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const STATE = { seen: "paid", before: "counted", to_come: "to come" } as const;

export function LongGameSection({
  game,
  saved,
  error,
}: {
  game: LongGame;
  saved: boolean;
  error: string;
}) {
  return (
    <section
      id="long-game"
      aria-labelledby="long-game-title"
      className="flex flex-col gap-3 text-sm"
    >
      <h2 id="long-game-title" className="text-xl font-semibold">
        The long game
      </h2>
      {saved && (
        <p role="status" className="text-emerald-800 dark:text-emerald-200">
          Saved. The dates are on your deadlines.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {game.pslf && (
        <div className="flex flex-col gap-2">
          <p>
            <strong>
              {game.pslf.counted} of {PSLF_PAYMENTS}
            </strong>{" "}
            qualifying payments counted for PSLF (Public Service Loan Forgiveness).{" "}
            {game.pslf.remaining === 0
              ? "That's all of them: apply for forgiveness."
              : `${game.pslf.remaining} to go: forgiven around ${dayLabel(game.pslf.forgivenOn!, { year: true })} if you pay on time.`}
          </p>
          <ol aria-label="PSLF months" className="grid grid-cols-3 gap-1 sm:grid-cols-6">
            {game.pslf.grid.map((m) => (
              <li
                key={m.month}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800"
              >
                {m.month}: {STATE[m.state]}
              </li>
            ))}
          </ol>
        </div>
      )}
      {game.forgiveness && game.tax && (
        <p>
          {formatCents(game.forgiveness.forgivenCents)} forgiven around{" "}
          {dayLabel(game.forgiveness.on, { year: true })}. {game.tax.note}
          {game.tax.taxable
            ? ` At a 22% rate that's about ${formatCents(game.tax.estimateCents)} (an estimate). It goes on your deadlines two years before, for your tax plan.`
            : ""}{" "}
          <a href={LONG_GAME_SOURCES.forgivenTax} className={LINK}>
            Source
          </a>
        </p>
      )}
      {game.refi && (
        <div role="note" className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          <p className="font-medium">Refinancing</p>
          <p>{game.refi.text}</p>
          {game.refi.lost.length > 0 && (
            <ul aria-label="What a refinance would give up" className="list-disc pl-5">
              {game.refi.lost.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <form action={saveDates} aria-label="Your dates" className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          Loan type
          <select name="loanType" defaultValue={game.loanType} className={INPUT}>
            <option value="federal">Federal</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Employer last certified
          <input name="lastCertifiedOn" type="date" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          Income-driven plan recertified by
          <input name="recertifyOn" type="date" className={INPUT} />
        </label>
        <SubmitButton className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 sm:col-span-3 sm:w-fit">
          Save my dates
        </SubmitButton>
      </form>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        <a href={LONG_GAME_SOURCES.pslfCertify} className={LINK}>
          Certify your employer
        </a>
        {" · "}
        <a href={LONG_GAME_SOURCES.recertify} className={LINK}>
          Recertify your income
        </a>
        {" · "}
        <a href={LONG_GAME_SOURCES.refinance} className={LINK}>
          Federal vs private loans
        </a>
      </p>
    </section>
  );
}
