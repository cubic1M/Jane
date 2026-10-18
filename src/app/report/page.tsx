import Link from "next/link";
import { Suspense } from "react";
import { AccountList } from "@/components/account-list";
import { AppHeader } from "@/components/app-header";
import { moneyFound } from "@/detection/engine";
import { listAccountSummaries } from "@/lib/accounts";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

async function ReportContent() {
  const user = await requireUser();
  const db = await scopedDb();
  const [accounts, findings, found] = await Promise.all([
    listAccountSummaries(db),
    db.findings.findMany({
      where: { status: { notIn: ["declined", "done", "failed"] } },
      select: { id: true, title: true },
      orderBy: [{ annualSavingsCents: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    }),
    moneyFound(user.id),
  ]);
  const transactions = accounts.reduce((sum, a) => sum + a.transactionCount, 0);

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your money report</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {transactions > 0
            ? `We've read ${transactions} transactions and found ${findings.length} things to look at.`
            : "No transactions yet."}
        </p>
      </div>
      {found > 0 && (
        <p className="text-lg">
          Estimated savings: <strong>{formatCents(found)} a year</strong>
        </p>
      )}
      {findings.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {findings.map((f) => (
            <li key={f.id}>{f.title}</li>
          ))}
        </ul>
      )}
      <AccountList accounts={accounts} />
      <Link href="/import" className="font-medium text-emerald-700 hover:underline">
        Import more transactions
      </Link>
    </>
  );
}

export default function ReportPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ReportContent />
      </Suspense>
    </main>
  );
}
