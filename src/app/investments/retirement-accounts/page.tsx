import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { LIMITS_SOURCE, LIMITS_YEAR } from "@/config/retirement";
import { ROTH_IRA_PHASEOUT_SOURCE, ROTH_RULE_SOURCE } from "@/config/retirement-accounts";
import { loadRetirementAccounts } from "@/lib/investments/retirement-accounts";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { linkRothIra, putInIra, raiseForMatch } from "./actions";

// Retirement accounts used fully (spec step 210, demo advice): every limit with what's
// used, the match left on the table, Roth or traditional, and the backdoor Roth.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const DONE: Record<string, string> = {
  requested: "Requested through the payroll stand-in. Your pay changes when your employer does it.",
  contributed: "Done in the simulated brokerage (no real money moves).",
  linked: "Demo Roth IRA linked.",
  changed: "That changed since you last looked. Here's where it stands.",
};
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const ROTH_WORDS = {
  roth: "Roth: you're in a lower bracket now, so paying the tax now usually wins.",
  traditional: "Traditional: you're in a higher bracket, so the deduction now usually wins.",
  mix: "A mix of Roth and traditional: your bracket is in the middle.",
} as const;

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/retirement-accounts">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadRetirementAccounts(user.id);
  const access = v.roth.access;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Retirement accounts, used fully</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every limit and every dollar of match, across your accounts. {LIMITS_YEAR} limits:{" "}
          {LIMITS_SOURCE}.
        </p>
      </div>
      {typeof done === "string" && Object.hasOwn(DONE, done) && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {DONE[done]}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Limits this year</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="font-normal">Account</th>
              <th className="text-right font-normal">Limit</th>
              <th className="text-right font-normal">Put in so far</th>
              <th className="text-right font-normal">Room left</th>
            </tr>
          </thead>
          <tbody>
            {v.limits.map((l) => (
              <tr key={l.key}>
                <td>
                  {l.label}
                  {l.catchUpCents > 0 && (
                    <span className="block text-xs text-zinc-500">
                      Includes {formatCents(l.catchUpCents)} catch-up
                    </span>
                  )}
                </td>
                <td className="text-right">{formatCents(l.limitCents)}</td>
                <td className="text-right">{formatCents(l.usedCents)}</td>
                <td className="text-right">{formatCents(l.roomCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {v.advice && v.match && (
        <section className="flex flex-col gap-2 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <h2 className="text-xl font-semibold">Employer match</h2>
          {v.match.missedCents > 0 ? (
            <>
              <p className="text-sm">
                You&apos;re putting in about {pct(v.match.employeeRate)} of pay. Your employer
                matches {pct(v.match.matchRate)} of what you put in, up to{" "}
                {pct(v.match.fullMatchRate)} of pay: you&apos;re leaving about{" "}
                {formatCents(v.match.missedCents)} a year of their money on the table. Getting all
                of it means about {formatCents(v.match.extraEmployeeCents)} more a year from your
                pay.
              </p>
              {v.pending ? (
                <p className="text-sm">
                  Requested: {pct(v.pending.toRate)} of pay from {v.pending.effectiveOn}.
                </p>
              ) : (
                <form action={raiseForMatch} className="flex flex-col gap-2">
                  <SimulatedBanner />
                  <button type="submit" className={`${BUTTON} self-start`}>
                    Raise to {pct(v.match.fullMatchRate)} of pay
                  </button>
                </form>
              )}
            </>
          ) : (
            <p className="text-sm">You&apos;re getting the whole match.</p>
          )}
          <DemoAdviceLabel />
        </section>
      )}

      {v.advice && (
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-xl font-semibold">Roth or traditional</h2>
          {v.roth.choice ? (
            <p className="text-sm">
              {ROTH_WORDS[v.roth.choice]} Your tax estimate puts the next dollar of income at{" "}
              {pct(v.roth.marginalRate ?? 0)}. ({ROTH_RULE_SOURCE}.)
            </p>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Fill in your tax profile and I&apos;ll choose by your bracket.
            </p>
          )}
          {access?.kind === "direct" && (
            <p className="text-sm">
              Your income is under the Roth IRA limit: you can fund one directly.
            </p>
          )}
          {access?.kind === "partial" && (
            <p className="text-sm">
              Your income is in the Roth IRA phase-out: about {pct(access.allowedShare)} of the
              limit can go in directly.
            </p>
          )}
          {access?.kind === "backdoor" && (
            <div className="text-sm">
              <p>
                Your income is over the Roth IRA limit, so a Roth IRA can&apos;t be funded directly.
                The backdoor route:
              </p>
              <ol className="list-decimal pl-5">
                {access.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p className="mt-1">{access.note} Jane doesn&apos;t do this one for you.</p>
            </div>
          )}
          <p className="text-xs text-zinc-500">Income limits: {ROTH_IRA_PHASEOUT_SOURCE}.</p>
          {v.ira && v.iraAllowedCents > 0 && access?.kind !== "backdoor" && (
            <form action={putInIra} className="flex flex-col gap-2">
              <input type="hidden" name="cents" value={v.iraAllowedCents} />
              <SimulatedBanner />
              <button type="submit" className={`${BUTTON} self-start`}>
                Put {formatCents(v.iraAllowedCents)} in {v.ira.name}
              </button>
            </form>
          )}
          {!v.ira && v.demo && (
            <form action={linkRothIra}>
              <button type="submit" className={BUTTON}>
                Link a demo Roth IRA
              </button>
            </form>
          )}
          <DemoAdviceLabel />
        </section>
      )}
    </>
  );
}

export default function RetirementAccountsPage(
  props: PageProps<"/investments/retirement-accounts">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
