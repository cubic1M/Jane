import Link from "next/link";
import { Suspense } from "react";
import { AccountList } from "@/components/account-list";
import { AppHeader } from "@/components/app-header";
import { listAccountSummaries } from "@/lib/accounts";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";

async function ReportContent() {
  const user = await requireUser();
  const accounts = await listAccountSummaries(await scopedDb());
  const transactions = accounts.reduce((sum, a) => sum + a.transactionCount, 0);

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your money report</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {transactions > 0
            ? `We've read ${transactions} transactions. Savings findings are coming next.`
            : "No transactions yet."}
        </p>
      </div>
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
