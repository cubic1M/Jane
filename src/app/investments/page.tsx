import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { SimulatedBanner } from "@/components/simulated-banner";
import { ViewTracker } from "@/components/view-tracker";
import { SIMULATED_PARTNER } from "@/config/brokerage";
import { explainer } from "@/config/learn";
import { scopedFor } from "@/lib/db-scoped";
import { formatBps, type HoldingView } from "@/insights/investments";
import { loadInvestments } from "@/lib/investments/holdings";
import { profileOf } from "@/lib/investments/profile";
import { profileSummary } from "@/planning/investor-profile";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// What the person owns (spec step 128): every investment and retirement account, what's in
// it and where each number came from, and the balances month by month.

const LINK = "font-medium text-emerald-700 hover:underline";
const CARD = "flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const signed = (cents: number) =>
  cents < 0 ? `−${formatCents(-cents)}` : `+${formatCents(cents)}`;
const shares = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

function HoldingRow({ h }: { h: HoldingView }) {
  return (
    <li className="flex flex-col gap-2 border-t border-zinc-100 pt-3 first:border-0 first:pt-0 dark:border-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium break-words">
            {h.name}
            {h.ticker && <span className="ml-1 text-sm text-zinc-500">{h.ticker}</span>}
          </span>
          <span className="text-sm text-zinc-500">
            {h.category ?? h.type ?? "Security"}
            {!h.isCash && ` · ${shares(h.quantity)} at ${formatCents(h.priceCents)}`}
          </span>
        </div>
        <span className="font-semibold">{formatCents(h.valueCents)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {h.costBasisCents !== null && !h.isCash && (
          <div>
            <dt className="text-zinc-500">Paid</dt>
            <dd>
              {formatCents(h.costBasisCents)}
              {h.gainCents !== null && (
                <span className={h.gainCents < 0 ? "ml-1 text-red-700" : "ml-1 text-emerald-700"}>
                  {signed(h.gainCents)}
                </span>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-zinc-500">Yearly fund cost</dt>
          <dd>{h.expenseRatioBps === null ? "Not known" : formatBps(h.expenseRatioBps)}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500">
        Source: {h.source}
        {h.factsSource ? `. Fund facts: ${h.factsSource}` : ""}.
      </p>
    </li>
  );
}

async function InvestmentsContent() {
  const user = await requireUser();
  await connection();
  const [data, answers, simulated] = await Promise.all([
    loadInvestments(user.id),
    profileOf(user.id),
    // Spec step 133: holdings shaped by simulated orders say so.
    scopedFor(user.id).brokerageOrders.count({ where: { partner: SIMULATED_PARTNER } }),
  ]);
  const profile = profileSummary(answers, data.asOf);
  const max = Math.max(1, ...data.months.map((m) => m.totalCents ?? 0));

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="investments_viewed" />
      {simulated > 0 && <SimulatedBanner />}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Investments</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What&apos;s in your retirement and investment accounts, as your bank reports it, with
          where every number comes from.
        </p>
      </div>

      {data.accounts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No investment or retirement accounts yet. When you{" "}
          <Link href="/connect" className={LINK}>
            link one
          </Link>
          , what it holds shows here.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className={CARD}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">In total</span>
              <span className="text-2xl font-semibold">{formatCents(data.totalCents)}</span>
              <span className="text-xs text-zinc-500">
                The same as in your{" "}
                <Link href="/net-worth" className={LINK}>
                  net worth
                </Link>
              </span>
            </div>
            <div className={CARD}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Retirement</span>
              <span className="text-2xl font-semibold">{formatCents(data.byKind.retirement)}</span>
            </div>
            <div className={CARD}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Other investing</span>
              <span className="text-2xl font-semibold">{formatCents(data.byKind.investment)}</span>
            </div>
          </section>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {profile.complete ? (
              <>
                Your investor profile: <strong>{profile.label}</strong>.{" "}
              </>
            ) : (
              <>Tell Jane what this money is for: four quick questions. </>
            )}
            <Link href="/investments/profile" className={LINK}>
              {profile.complete ? "Change it" : "Answer them"}
            </Link>
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/investments/fees" className={LINK}>
              What investing costs you
            </Link>
            : every fee, a year and over 30 years.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/investments/review" className={LINK}>
              Portfolio review
            </Link>
            : your mix against the target for your risk level.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/investments/retirement" className={LINK}>
              Retirement
            </Link>
            : what you could have by 67, and your employer match.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/investments/auto" className={LINK}>
              Automatic investing
            </Link>
            : every payday, only what safe to spend doesn&apos;t need.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/investments/accounts" className={LINK}>
              Which account first
            </Link>
            : the match, HSA, IRA or taxable, and where to hold what.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Learn:{" "}
            {["index-funds", "fees", "the-match", "roth-vs-traditional", "rebalancing"].map(
              (slug, i) => (
                <span key={slug}>
                  {i > 0 && " · "}
                  <Link href={`/learn/${slug}`} className={LINK}>
                    {explainer(slug)?.title.toLowerCase()}
                  </Link>
                </span>
              ),
            )}
          </p>

          {data.byAssetClass.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold">By type</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {data.byAssetClass.map((c) => (
                  <li key={c.assetClass} className="flex justify-between gap-2">
                    <span>{c.label}</span>
                    <span>{formatCents(c.valueCents)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-500">
                Funds are split by what they hold, from the fund facts shown on each one.
              </p>
            </section>
          )}

          <ul className="flex flex-col gap-3">
            {data.accounts.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-semibold break-words">{a.name}</span>
                    <span className="text-sm text-zinc-500">
                      {a.label}
                      {a.institution ? ` · ${a.institution}` : ""}
                    </span>
                  </div>
                  <span className="text-xl font-semibold">
                    {a.balanceCents === null ? "–" : formatCents(a.balanceCents)}
                  </span>
                </div>
                {a.holdings.length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Your bank reports the balance but not what&apos;s in it.
                  </p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-3">
                      {a.holdings.map((h) => (
                        <HoldingRow key={h.id} h={h} />
                      ))}
                    </ul>
                    {!a.holdingsMatch && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        The holdings add up to {formatCents(a.holdingsCents)}, not the balance your
                        bank reports; the balance is what counts in your net worth.
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">Month by month</h2>
            {data.months.every((m) => m.totalCents === null) ? (
              <p className="text-zinc-600 dark:text-zinc-400">
                We take a snapshot of your balances each day; this fills in from today.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.months.map((m) => (
                  <li key={m.month} className="grid grid-cols-[5.5rem_1fr_7rem] items-center gap-2">
                    <span className="text-zinc-500">{monthLabel(m.month)}</span>
                    <span
                      className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
                      aria-hidden
                    >
                      <span
                        className="block h-full bg-emerald-700"
                        style={{ width: `${(m.retirementCents / max) * 100}%` }}
                      />
                      <span
                        className="block h-full bg-emerald-400"
                        style={{ width: `${(m.investmentCents / max) * 100}%` }}
                      />
                    </span>
                    <span className="text-right">
                      {m.totalCents === null ? "–" : formatCents(m.totalCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-zinc-500">Darker: retirement. Lighter: other investing.</p>
          </section>
        </>
      )}
    </>
  );
}

export default function InvestmentsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <InvestmentsContent />
      </Suspense>
    </main>
  );
}
