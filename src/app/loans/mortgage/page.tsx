import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { PMI_SOURCE } from "@/config/debt";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import { loadMortgage } from "@/lib/mortgage";
import { ensureChecked } from "@/lib/refinance";
import { requireUser } from "@/lib/session";
import { pmiTimelineLines } from "@/lib/jane-agent/home-equity-replies";

// The mortgage, watched (spec step 115): PMI by the one rule (the home's value when the loan
// began, as on /loans/equity, where the request is drafted), escrow changes, extra principal
// and the refinance break-even.

const LINK = "font-medium text-emerald-700 hover:underline";
const BOX =
  "flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800";

const months = (n: number) =>
  n >= 24 ? `${Math.round(n / 12)} years` : `${n} ${n === 1 ? "month" : "months"}`;

async function MortgageContent() {
  const user = await requireUser();
  await connection();
  // The break-even needs offers: before Jane's first monthly check, she checks now.
  await ensureChecked(user.id);
  const m = await loadMortgage(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your mortgage</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane watches the biggest loan: when PMI can come off, changes in your escrow, what extra
          principal would save, and whether refinancing would pay.
        </p>
      </div>
      {!m ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No mortgage on your linked accounts.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <section className={BOX} aria-label="The loan">
            <p className="text-base font-semibold">{m.loan.name}</p>
            <p>
              {formatCents(m.loan.balanceCents!)} at{" "}
              {m.loan.aprBps === null
                ? "a rate your bank doesn't report"
                : formatRate(m.loan.aprBps)}
              {m.loan.paymentCents ? `, ${formatCents(m.loan.paymentCents)} a month` : ""}
              {m.escrowBalanceCents !== null
                ? `. ${formatCents(m.escrowBalanceCents)} in escrow.`
                : "."}
            </p>
          </section>

          <section id="pmi" aria-labelledby="pmi-title" className={BOX}>
            <h2 id="pmi-title" className="text-xl font-semibold">
              Private mortgage insurance (PMI)
            </h2>
            {/* One PMI rule (loans QA): the home's value when the loan began, as /loans/equity. */}
            {m.hasPmi === false && <p>Your bank reports no PMI on this loan.</p>}
            {m.hasPmi === null && <p>Your bank doesn&apos;t say whether this loan has PMI.</p>}
            {m.hasPmi === true && !m.pmi && (
              <p>
                Your loan has PMI.{" "}
                <Link href="/loans/equity" className={LINK}>
                  Tell Jane the home&apos;s value when the loan began
                </Link>{" "}
                and she works out when it can come off.
              </p>
            )}
            {m.pmi && (
              <>
                {pmiTimelineLines(m.pmi).map((l) => (
                  <p key={l}>{l}</p>
                ))}
                {m.pmi.canAskNow && !m.pmi.endsNow && (
                  <Link href="/loans/equity" className={LINK}>
                    The request Jane drafted for your servicer
                  </Link>
                )}
              </>
            )}
            <p className="text-xs text-zinc-500">
              Rules from{" "}
              <a href={PMI_SOURCE} className={LINK}>
                the CFPB
              </a>
              .
            </p>
          </section>

          {m.escrow && (
            <section aria-label="Escrow" className={BOX}>
              <h2 className="text-xl font-semibold">Escrow</h2>
              <p>
                Your payment went {m.escrow.changeCents > 0 ? "up" : "down"}{" "}
                {formatCents(Math.abs(m.escrow.changeCents))}, from{" "}
                {formatCents(m.escrow.fromCents)} to {formatCents(m.escrow.toCents)}. Your rate is
                fixed, so that&apos;s escrow: usually property taxes or home insurance.
              </p>
            </section>
          )}

          {m.extra && m.extra.scenarios.length > 0 && (
            <section aria-label="Extra principal" className={BOX}>
              <h2 className="text-xl font-semibold">Paying extra principal</h2>
              <table className="w-full text-left">
                <caption className="sr-only">Extra principal each month</caption>
                <thead>
                  <tr className="text-zinc-500">
                    <th scope="col" className="py-1 font-normal">
                      Extra a month
                    </th>
                    <th scope="col" className="py-1 font-normal">
                      Paid off sooner by
                    </th>
                    <th scope="col" className="py-1 font-normal">
                      Interest saved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {m.extra.scenarios.map((s) => (
                    <tr
                      key={s.extraCents}
                      className="border-t border-zinc-200 dark:border-zinc-800"
                    >
                      <td className="py-1">{formatCents(s.extraCents)}</td>
                      <td className="py-1">{months(s.monthsSaved)}</td>
                      <td className="py-1">{formatCents(s.interestSavedCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.hasPrepaymentPenalty && (
                <p className="text-amber-800 dark:text-amber-300">
                  Your loan has a prepayment penalty: check its terms before paying extra.
                </p>
              )}
            </section>
          )}

          {m.refi && (
            <section aria-label="Refinancing" className={BOX}>
              <h2 className="text-xl font-semibold">Refinancing</h2>
              {m.refi.breakEvenMonths === null ? (
                <p>
                  It doesn&apos;t pay now: the best rate Jane found ({formatRate(m.refi.aprBps)},{" "}
                  {m.refi.lender}) is no lower than yours.
                </p>
              ) : (
                <p>
                  {m.refi.lender} at {formatRate(m.refi.aprBps)} saves{" "}
                  {formatCents(m.refi.monthlySavingCents)} a month; the{" "}
                  {formatCents(m.refi.closingCostsCents)} closing costs are paid back after{" "}
                  {months(m.refi.breakEvenMonths)}.
                </p>
              )}
              <Link href="/loans/refinance" className={LINK}>
                See every offer
              </Link>
            </section>
          )}
        </>
      )}
    </>
  );
}

export default function MortgagePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <MortgageContent />
      </Suspense>
    </main>
  );
}
