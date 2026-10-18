import Link from "next/link";
import { Suspense } from "react";
import { AccountList } from "@/components/account-list";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { moneyFound } from "@/detection/engine";
import { listAccountSummaries } from "@/lib/accounts";
import { CARD_SELECT } from "@/lib/cards";
import { scopedDb } from "@/lib/db-scoped";
import { explanationFor } from "@/lib/card-text";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Shown when nothing was found, so the person knows what we looked at.
const WHAT_WE_CHECK = [
  "Subscriptions you may not use",
  "Paying for two services that do the same thing",
  "Bills that went up",
  "Bank and card fees",
  "Cash earning little interest",
  "Insurance you could reshop",
  "Credit card interest",
];

async function ReportContent() {
  const user = await requireUser();
  const db = await scopedDb();
  const [accounts, findings, found] = await Promise.all([
    listAccountSummaries(db),
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: CARD_SELECT,
      orderBy: [{ annualSavingsCents: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    }),
    moneyFound(user.id),
  ]);
  const transactions = accounts.reduce((sum, a) => sum + a.transactionCount, 0);

  return (
    <>
      <AppHeader email={user.email} />
      <ViewTracker event="report_viewed" />

      {transactions === 0 ? (
        <section className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Your money report</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            We haven&apos;t read any transactions yet. Link your bank and we&apos;ll look for money
            you&apos;re losing.
          </p>
          <Link href="/connect" className="font-medium text-emerald-700 hover:underline">
            Link an account
          </Link>
        </section>
      ) : findings.length === 0 ? (
        <section className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Nothing to fix right now</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            We read {transactions} transactions and didn&apos;t find anything new. Here&apos;s what
            we checked:
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {WHAT_WE_CHECK.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
          <Link href="/actions" className="font-medium text-emerald-700 hover:underline">
            See what we&apos;re working on
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {found > 0
                ? `We found ${formatCents(found)} a year`
                : `We found ${findings.length} ${findings.length === 1 ? "thing" : "things"} to look at`}
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Estimates from {transactions} transactions. Open each one to decide; nothing changes
              until you say yes.
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {findings.map((finding) => {
              const text = explanationFor(finding);
              return (
                <li key={finding.id}>
                  <Link
                    href={`/report/${finding.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <span className="flex flex-col gap-1">
                      <span className="font-semibold">{text.title}</span>
                      <span className="text-sm text-zinc-600 dark:text-zinc-400">
                        {finding.annualSavingsCents !== null
                          ? `Could save about ${formatCents(finding.annualSavingsCents)} a year`
                          : "Savings depend on the quotes we find"}
                      </span>
                    </span>
                    <span aria-hidden className="text-zinc-400">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {accounts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Accounts we read</h2>
          <AccountList accounts={accounts} />
          <Link href="/connect" className="font-medium text-emerald-700 hover:underline">
            Add or manage accounts
          </Link>
        </section>
      )}
    </>
  );
}

export default function ReportPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ReportContent />
      </Suspense>
    </main>
  );
}
