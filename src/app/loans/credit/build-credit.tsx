import { CREDIT_SCORE_SOURCE, STATEMENT_CUSHION_CENTS } from "@/config/credit-building";
import type { CreditBuilding } from "@/lib/credit-building";
import { dayLabel } from "@/lib/day-label";
import { ESTIMATE_LABEL, streakLine } from "@/lib/jane-agent/credit-building-replies";
import { formatCents } from "@/lib/money";
import { openBuilderAction, payStatementAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Building credit (spec step 175) on /loans/credit: the payment before the next statement
// closes, the on-time streak, the score simulator (labelled an estimate) and, for a thin
// file, credit-builder stand-ins.

const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const DONE: Record<string, string> = {
  paid: "Scheduled just now.",
  opened: "Opened just now.",
};

export function BuildCredit({
  data,
  done,
  error,
}: {
  data: CreditBuilding;
  done?: string;
  error?: string;
}) {
  const s = data.statement;
  const streak = streakLine(data);
  return (
    <section id="build" aria-labelledby="build-heading" className="flex flex-col gap-3 text-sm">
      <h2 id="build-heading" className="text-xl font-semibold">
        Build your credit
      </h2>
      {done && DONE[done] && (
        <p role="status" className="text-emerald-800 dark:text-emerald-200">
          {DONE[done]}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {s && (
        <div aria-label="Before the statement" role="group" className="flex flex-col gap-1">
          <p>
            Your {s.cardName}&apos;s statement closes on {dayLabel(s.closesOn)}: the balance on it
            then is what&apos;s reported to the bureaus.
          </p>
          {s.scheduled ? (
            <p>
              {formatCents(s.scheduled.amountCents)} goes to it on {dayLabel(s.scheduled.runOn)}
              {s.scheduled.by === "autopilot" ? ", scheduled by Jane" : ""}.
            </p>
          ) : s.suggested ? (
            <form action={payStatementAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="accountId" value={s.accountId} />
              <input type="hidden" name="closesOn" value={s.closesOn} />
              <span>
                Pay {formatCents(s.suggested.amountCents)} by {dayLabel(s.payOn)} to report under{" "}
                {s.suggested.target === "good" ? "10%" : "30%"} of your limits.
              </span>
              {s.canPay && (
                <SubmitButton className={BUTTON}>
                  Pay {formatCents(s.suggested.amountCents)} before it closes
                </SubmitButton>
              )}
            </form>
          ) : s.toUnderHighCents > 0 ? (
            <p>
              Paying {formatCents(s.toUnderHighCents)} would bring it under 30%, but checking
              can&apos;t spare it and keep {formatCents(STATEMENT_CUSHION_CENTS)}.
            </p>
          ) : (
            <p>Card use is already under 30%, which helps.</p>
          )}
        </div>
      )}
      {streak && <p aria-label="On-time streak">{streak}</p>}
      {data.estimates.length > 0 && data.score !== null && (
        <div className="flex flex-col gap-1">
          <table aria-label="Score simulator" className="w-full text-left">
            <caption className="text-left font-medium">
              Score simulator: estimates from {data.score}
            </caption>
            <thead>
              <tr className="text-zinc-600 dark:text-zinc-400">
                <th className="py-1 font-medium">If you</th>
                <th className="py-1 font-medium">Estimated score</th>
              </tr>
            </thead>
            <tbody>
              {data.estimates.map((e) => (
                <tr key={e.key} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1">{e.label}</td>
                  <td className="py-1">
                    {e.score} ({e.change > 0 ? "+" : ""}
                    {e.change})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p role="note" className="text-xs text-zinc-600 dark:text-zinc-400">
            {ESTIMATE_LABEL}{" "}
            <a href={CREDIT_SCORE_SOURCE} className="font-medium text-emerald-700 hover:underline">
              What moves a score (CFPB)
            </a>
          </p>
        </div>
      )}
      {data.thin && data.builders.length > 0 && (
        <ul aria-label="Credit builders" className="flex flex-col gap-3">
          {data.builders.map((b) => (
            <li key={b.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-medium">
                {b.name} <span className="text-zinc-600 dark:text-zinc-400">from {b.issuer}</span>
              </p>
              <p>{b.summary}</p>
              <form action={openBuilderAction} className="mt-2">
                <input type="hidden" name="productId" value={b.id} />
                <SubmitButton className={BUTTON}>Open the {b.name}</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
