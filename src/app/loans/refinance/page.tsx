import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { REFI_MIN_SAVING_CENTS } from "@/config/debt";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import { ensureChecked, loadRefinance } from "@/lib/refinance";
import { requireUser } from "@/lib/session";
import type { RefinanceComparison } from "@/planning/refinance";
import { listApplications, statusLine } from "@/lib/loan-applications";
import { loadTransfers, type Transfers } from "@/lib/balance-transfers";
import { shortMonth } from "@/planning/balance-transfer";
import { applyAction, checkNow, endTransferAction, startTransferAction } from "./actions";

// Refinance offers (spec step 111): for each loan and card, the offers Jane checked, each over
// the debt's own remaining months, compared with keeping it (paying what you pay now until it's
// gone), fees included: the same comparison as the loan options card. Sample offers from the
// stand-in lender catalog, for demo-bank people only.

const LINK = "font-medium text-emerald-700 hover:underline";

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Comparison({ c }: { c: RefinanceComparison }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{c.debtName}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatCents(c.balanceCents)} at {formatRate(c.currentAprBps)}. Keeping it, at{" "}
          {formatCents(c.currentMonthlyCents)} a month
          {c.escrowCents !== undefined &&
            ` in principal and interest (your payment also holds ${formatCents(c.escrowCents)} of escrow, which stays)`}
          , it&apos;s paid off in {c.keepMonths} months and costs {formatCents(c.currentTotalCents)}{" "}
          in all. Offers are priced over {c.termMonths} months.
        </p>
      </div>
      {c.cashPayoffCents ? (
        <div className="flex flex-col gap-1 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
          <p className="font-medium">Jane&apos;s pick: pay it off from your cash</p>
          <p>
            Paying it off from savings would save about {formatCents(c.cashPayoffCents)} and still
            keep your emergency cushion, more than any loan.
          </p>
          <DemoAdviceLabel />
        </div>
      ) : c.turnedDown ? (
        <p className="text-sm">
          The offers look cheaper, but a lender would likely turn this down: {c.turnedDown} Jane
          wouldn&apos;t apply now.
        </p>
      ) : c.pick ? (
        <div className="flex flex-col gap-1 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
          <p className="font-medium">
            Jane&apos;s pick: {c.pick.offer.lender} at {formatRate(c.pick.offer.aprBps)}{" "}
            {c.pick.offer.rateType}
          </p>
          {c.why.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <DemoAdviceLabel />
          <form action={applyAction} className="mt-2">
            <input type="hidden" name="debtKey" value={c.debtKey} />
            <input type="hidden" name="lender" value={c.pick.offer.lender} />
            <button
              type="submit"
              className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800"
            >
              Apply with {c.pick.offer.lender}
            </button>
            <span className="ml-3 text-xs text-zinc-600 dark:text-zinc-400">
              You review the terms before anything is sent.
            </span>
          </form>
        </div>
      ) : (
        <p className="text-sm">
          No offer saves {formatCents(REFI_MIN_SAVING_CENTS)} or more against keeping it, fees
          included, so Jane wouldn&apos;t switch.
        </p>
      )}
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Offers for {c.debtName}</caption>
        <thead>
          <tr className="text-zinc-500">
            <th scope="col" className="py-1 font-normal">
              Lender
            </th>
            <th scope="col" className="py-1 font-normal">
              Rate
            </th>
            <th scope="col" className="py-1 font-normal">
              A month
            </th>
            <th scope="col" className="py-1 font-normal">
              In all, with fees
            </th>
            <th scope="col" className="py-1 font-normal">
              Saving
            </th>
          </tr>
        </thead>
        <tbody>
          {c.offers.map((s) => (
            <tr key={s.offer.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1">
                {s.offer.lender}
                <span className="block text-xs text-zinc-500">
                  {s.offer.feeLabel}
                  {s.breakEvenMonths !== null ? `, paid back in ${s.breakEvenMonths} months` : ""}
                </span>
              </td>
              <td className="py-1">
                {formatRate(s.offer.aprBps)} {s.offer.rateType}
              </td>
              <td className="py-1">{formatCents(s.monthlyCents)}</td>
              <td className="py-1">{formatCents(s.totalCents)}</td>
              <td className="py-1">
                {s.savingCents >= 0
                  ? formatCents(s.savingCents)
                  : `${formatCents(-s.savingCents)} more`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}

// Spec step 113: 0% balance transfers for each card, fee counted, and the ones running.
function TransfersSection({ data, started }: { data: Transfers; started: unknown }) {
  const running = data.transfers.filter((t) => t.status === "active");
  if (data.comparisons.length === 0 && running.length === 0) return null;
  return (
    <section id="transfers" aria-labelledby="transfers-title" className="flex flex-col gap-3">
      <h2 id="transfers-title" className="text-xl font-semibold">
        Move card debt to 0%
      </h2>
      {started === "started" && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          Got it. The 0% end is on your deadlines, and Jane reminds you before it.
        </p>
      )}
      {started === "done" && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          Paid off before the 0% ended. Ticked off your deadlines.
        </p>
      )}
      {running.length > 0 && (
        <ul aria-label="Your transfers" className="flex flex-col gap-2 text-sm">
          {running.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <span>
                {formatCents(t.amountCents)} moved to {t.cardName}: 0% until{" "}
                {shortMonth(t.promoEndsOn)}. Pay {formatCents(t.monthlyNeededCents)} a month to
                clear it, the {formatCents(t.feeCents)} fee included.
              </span>
              <form action={endTransferAction}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="font-medium text-emerald-700 hover:underline">
                  It&apos;s paid off
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {data.comparisons.map((c) => (
        <div
          key={c.debtKey}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 text-sm [overflow-wrap:anywhere] dark:border-zinc-800"
        >
          <p>
            Your {c.debtName}: {formatCents(c.balanceCents)} at {formatRate(c.aprBps)}.
          </p>
          {c.pick && !running.some((t) => t.fromDebtKey === c.debtKey) && (
            <div className="flex flex-col gap-1 rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950">
              <p className="font-medium">Jane&apos;s pick: {c.pick.offer.cardName}</p>
              {c.why.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <DemoAdviceLabel />
              <form action={startTransferAction} className="mt-2">
                <input type="hidden" name="debtKey" value={c.debtKey} />
                <input type="hidden" name="offerId" value={c.pick.offer.id} />
                <button
                  type="submit"
                  className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800"
                >
                  I&apos;ve moved it to {c.pick.offer.cardName}
                </button>
              </form>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Opening the card and moving the balance are yours to do; this tells Jane you have.
              </p>
            </div>
          )}
          <table className="w-full text-left">
            <caption className="sr-only">0% offers for {c.debtName}</caption>
            <thead>
              <tr className="text-zinc-500">
                <th scope="col" className="py-1 font-normal">
                  Card
                </th>
                <th scope="col" className="py-1 font-normal">
                  0% for
                </th>
                <th scope="col" className="py-1 font-normal">
                  Fee
                </th>
                <th scope="col" className="py-1 font-normal">
                  To clear it
                </th>
                <th scope="col" className="py-1 font-normal">
                  Saving, fee counted
                </th>
              </tr>
            </thead>
            <tbody>
              {c.offers.map((s) => (
                <tr key={s.offer.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1">{s.offer.cardName}</td>
                  <td className="py-1">{s.offer.promoMonths} months</td>
                  <td className="py-1">{formatCents(s.offer.feeCents)}</td>
                  <td className="py-1">{formatCents(s.monthlyNeededCents)} a month</td>
                  <td className="py-1">
                    {s.savingCents === null ? "–" : formatCents(s.savingCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

async function RefinanceContent({
  searchParams,
}: {
  searchParams: PageProps<"/loans/refinance">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  // Opened before Jane's first monthly check: she checks now.
  await ensureChecked(user.id);
  const [refi, apps, transfers] = await Promise.all([
    loadRefinance(user.id),
    listApplications(user.id),
    loadTransfers(user.id),
  ]);
  const shownApps = apps.filter((a) => a.status !== "withdrawn");
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Refinance offers</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane checks rates for your loans and cards every month and compares each offer, over the
          debt&apos;s own remaining months, with keeping what you have, fees included. Checking is a
          soft check: it doesn&apos;t affect a credit score, and nothing is applied for until you
          say so.
        </p>
      </div>
      {!refi.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Offers come from a lending partner, and there isn&apos;t one for your accounts yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <p
            role="note"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            These are sample offers from a stand-in lender catalog for the demo bank, not real
            offers.
          </p>
          {error && (
            <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
              {error}
            </p>
          )}
          {shownApps.length > 0 && (
            <section aria-labelledby="apps" className="flex flex-col gap-2">
              <h2 id="apps" className="text-xl font-semibold">
                Your applications
              </h2>
              <ul className="flex flex-col gap-1 text-sm">
                {shownApps.map((a) => (
                  <li key={a.id}>
                    <Link href={`/loans/apply/${a.id}`} className={LINK}>
                      {a.lender} for your {a.oldName}
                    </Link>
                    : {statusLine(a)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {params.checked === "1" && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Checked just now.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <span>
              {refi.checkedOn
                ? `Last checked ${dateLabel(refi.checkedOn)}.`
                : "Jane hasn't checked yet."}
            </span>
            <form action={checkNow}>
              <button type="submit" className="font-medium text-emerald-700 hover:underline">
                Check rates now
              </button>
            </form>
          </div>
          {refi.comparisons.length > 0 && (
            <ul aria-label="Offers by debt" className="flex flex-col gap-3">
              {refi.comparisons.map((c) => (
                <Comparison key={c.debtKey} c={c} />
              ))}
            </ul>
          )}
          <TransfersSection data={transfers} started={params.transfer} />
        </>
      )}
    </>
  );
}

export default function RefinancePage({ searchParams }: PageProps<"/loans/refinance">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <RefinanceContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
