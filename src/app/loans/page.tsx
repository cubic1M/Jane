import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { AssetPrompts } from "@/components/asset-prompts";
import { ViewTracker } from "@/components/view-tracker";
import { debtSummary, formatRate } from "@/insights/loans";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { assetPrompts } from "@/lib/owned-assets";
import { requireUser } from "@/lib/session";

const LINK = "font-medium text-emerald-700 hover:underline";

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function LoansContent() {
  const user = await requireUser();
  await connection();
  const db = await scopedDb();
  const [accounts, linked] = await Promise.all([
    db.accounts.findMany({
      where: { type: { in: ["credit", "loan"] } },
      select: {
        id: true,
        name: true,
        mask: true,
        type: true,
        subtype: true,
        currentBalanceCents: true,
        liability: {
          select: {
            aprBps: true,
            rateType: true,
            minimumPaymentCents: true,
            nextPaymentDueDate: true,
            payoffDate: true,
            isOverdue: true,
            pastDueCents: true,
            ytdInterestPaidCents: true,
            description: true,
          },
        },
      },
    }),
    // Mortgages and car loans with a home or car linked (spec step 67).
    db.ownedAssets.findMany({ select: { loanAccountId: true } }),
  ]);
  const prompts = assetPrompts(
    accounts,
    linked.map((o) => o.loanAccountId),
  );
  const summary = debtSummary(accounts, new Date().toISOString().slice(0, 10));

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="loans_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Loans and cards</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What you owe, with the rates, payments and dates your bank reports. Nothing here is
          estimated.
        </p>
      </div>

      {summary.lines.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No loans or cards yet. When you{" "}
          <Link href="/connect" className={LINK}>
            link a bank
          </Link>{" "}
          that reports them, they show here with their rates and due dates.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">You owe</span>
              <span className="text-2xl font-semibold">{formatCents(summary.totalOwedCents)}</span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Due each month</span>
              <span className="text-2xl font-semibold">
                {formatCents(summary.totalMonthlyCents)}
              </span>
              {summary.missingMonthly > 0 && (
                <span className="text-xs text-zinc-500">
                  Leaves out {summary.missingMonthly} without a payment from the bank.
                </span>
              )}
            </div>
          </section>

          <ul className="flex flex-col gap-3">
            {summary.lines.map((line) => (
              <li
                key={line.id}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-semibold break-words">{line.name}</span>
                    <span className="text-sm text-zinc-500">
                      {line.kindLabel}
                      {line.description ? ` · ${line.description}` : ""}
                    </span>
                  </div>
                  <span className="text-xl font-semibold">
                    {line.balanceCents === null ? "–" : formatCents(line.balanceCents)}
                  </span>
                </div>
                {line.overdue && (
                  <p
                    role="status"
                    className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
                  >
                    Your bank shows this as overdue
                    {line.pastDueCents ? `: ${formatCents(line.pastDueCents)} past due` : ""}.
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-zinc-500">Rate</dt>
                    <dd>
                      {line.aprBps === null ? "Not reported" : formatRate(line.aprBps)}
                      {line.rateType ? ` ${line.rateType}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">
                      {line.kindLabel === "Credit card" ? "Minimum" : "Monthly payment"}
                    </dt>
                    <dd>
                      {line.monthlyCents === null ? "Not reported" : formatCents(line.monthlyCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Next due</dt>
                    <dd>
                      {line.nextDue === null ? "Not reported" : dateLabel(line.nextDue)}
                      {line.dueSoon && (
                        <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                          soon
                        </span>
                      )}
                    </dd>
                  </div>
                  {line.payoffDate && (
                    <div>
                      <dt className="text-zinc-500">Paid off by</dt>
                      <dd>{dateLabel(line.payoffDate)}</dd>
                    </div>
                  )}
                  {line.ytdInterestPaidCents !== null && (
                    <div>
                      <dt className="text-zinc-500">Interest paid this year</dt>
                      <dd>{formatCents(line.ytdInterestPaidCents)}</dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>

          <AssetPrompts prompts={prompts} />

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Own a home or a car?{" "}
            <Link href="/things" className={LINK}>
              Things you own
            </Link>{" "}
            shows what you own of it, from the values you give.
          </p>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Want to see how paying them down could go?{" "}
            <Link href="/debt" className={LINK}>
              Try the payoff planner
            </Link>
            . Your statements are the source of truth.
          </p>
        </>
      )}
    </>
  );
}

export default function LoansPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <LoansContent />
      </Suspense>
    </main>
  );
}
