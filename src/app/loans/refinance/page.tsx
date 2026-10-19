import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { REFI_MIN_SAVING_CENTS } from "@/config/debt";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import { loadRefinance } from "@/lib/refinance";
import { requireUser } from "@/lib/session";
import type { RefinanceComparison } from "@/planning/refinance";
import { checkNow } from "./actions";

// Refinance offers (spec step 111): for each loan and card, the offers Jane checked,
// compared with keeping it over the same months, fees included. Sample offers from the
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
          {formatCents(c.balanceCents)} at {formatRate(c.currentAprBps)}. Keeping it costs{" "}
          {formatCents(c.currentTotalCents)} over the next {c.termMonths} months (
          {formatCents(c.currentMonthlyCents)} a month).
        </p>
      </div>
      {c.pick ? (
        <div className="flex flex-col gap-1 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
          <p className="font-medium">
            Jane&apos;s pick: {c.pick.offer.lender} at {formatRate(c.pick.offer.aprBps)}{" "}
            {c.pick.offer.rateType}
          </p>
          {c.why.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <DemoAdviceLabel />
        </div>
      ) : (
        <p className="text-sm">
          No offer saves {formatCents(REFI_MIN_SAVING_CENTS)} or more over the same months, fees
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

async function RefinanceContent({
  searchParams,
}: {
  searchParams: PageProps<"/loans/refinance">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const refi = await loadRefinance(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Refinance offers</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane checks rates for your loans and cards every month and compares each offer with
          keeping what you have, over the same months, fees included. Checking is a soft check: it
          doesn&apos;t affect a credit score, and nothing is applied for until you say so.
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
