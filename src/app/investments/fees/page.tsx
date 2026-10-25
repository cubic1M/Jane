import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { Assumptions } from "@/components/assumptions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { formatBps } from "@/insights/investments";
import { equivalentsSaving, type Range } from "@/insights/investment-fees";
import { adviceMode } from "@/lib/advice-mode";
import { loadFees } from "@/lib/investments/fees";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { LoadingBar } from "@/components/loading-bar";

// What investing costs the person (spec step 130): each fund's yearly cost, advisory and
// account fees, what it all costs over 30 years as a range, and, in demo advice mode, a
// lower-cost equivalent for each costly fund.

const CARD = "flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const span = (r: Range) => `${formatCents(r.lowCents)} to ${formatCents(r.highCents)}`;

async function FeesContent() {
  const user = await requireUser();
  await connection();
  const [{ fees }, advice] = await Promise.all([loadFees(user.id), adviceMode(user.id)]);
  const saving = equivalentsSaving(fees.equivalents);
  const empty = fees.funds.length === 0 && fees.advisoryCents + fees.accountFeesCents === 0;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">What investing costs you</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every fee here comes from your holdings and your accounts&apos; own fee records.
        </p>
      </div>

      {empty ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No fees found yet. When your accounts report what they hold, each fund&apos;s yearly cost
          shows here.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className={CARD}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">About a year</span>
              <span className="text-2xl font-semibold">{formatCents(fees.totalYearlyCents)}</span>
            </div>
            <div className={CARD}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Over {fees.years} years, with growth
              </span>
              <span className="text-2xl font-semibold">{span(fees.overYears)}</span>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Where it goes</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {fees.funds.map((f) => (
                <li key={f.holding.id} className="flex flex-wrap justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {f.holding.name} <span className="text-zinc-500">({f.accountName})</span>
                    <span className="block text-xs text-zinc-500">
                      {formatBps(f.expenseRatioBps)} a year on {formatCents(f.holding.valueCents)}
                    </span>
                  </span>
                  <span>{formatCents(f.yearlyCents)} a year</span>
                </li>
              ))}
              {fees.advisoryCents > 0 && (
                <li className="flex justify-between gap-2">
                  <span>Advisory fees, last 12 months</span>
                  <span>{formatCents(fees.advisoryCents)}</span>
                </li>
              )}
              {fees.accountFeesCents > 0 && (
                <li className="flex justify-between gap-2">
                  <span>Account fees, last 12 months</span>
                  <span>{formatCents(fees.accountFeesCents)}</span>
                </li>
              )}
            </ul>
            {fees.unknown.length > 0 && (
              <p className="text-xs text-zinc-500">
                Yearly cost not known for: {fees.unknown.join(", ")}.
              </p>
            )}
          </section>

          {advice && fees.equivalents.length > 0 && (
            <section className="flex flex-col gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
              <h2 className="text-xl font-semibold">Lower-cost equivalents</h2>
              <p className="text-sm">
                Switching could save about {formatCents(saving.yearlyCents)} a year, roughly{" "}
                {span(saving.overYears)} over {fees.years} years.
              </p>
              <ul className="flex flex-col gap-3 text-sm">
                {fees.equivalents.map((e) => (
                  <li key={e.holding.id} className="flex flex-col gap-1">
                    <span>
                      <strong>{e.holding.name}</strong> ({formatBps(e.holding.expenseRatioBps!)}) in
                      your {e.accountName} → <strong>{e.name}</strong> (
                      {formatBps(e.expenseRatioBps)}), {e.category}
                      {e.inPlanMenu ? ", offered in your plan" : ""}.
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      About {formatCents(e.yearlySavingCents)} a year; {span(e.overYears)} over{" "}
                      {fees.years} years.
                    </span>
                  </li>
                ))}
              </ul>
              <DemoAdviceLabel />
            </section>
          )}

          <Assumptions />
        </>
      )}
    </>
  );
}

export default function FeesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <FeesContent />
      </Suspense>
    </main>
  );
}
