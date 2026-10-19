import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AddAccountForm } from "./add-account-form";
import { ImportForm } from "./import-form";
import { AppHeader } from "@/components/app-header";
import { AccountList } from "@/components/account-list";
import { listAccountSummaries } from "@/lib/accounts";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";

async function ImportContent() {
  const user = await requireUser();
  const db = await scopedDb();
  if (!(await canImportCsv(user, db))) redirect("/connect");
  const accounts = await listAccountSummaries(db);

  return (
    <>
      <AppHeader user={user} />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Import your transactions</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Download your statements from your bank&apos;s website as CSV, OFX or QFX (often called
          &ldquo;Quicken&rdquo; or &ldquo;Money&rdquo; downloads) and upload them here. Files are
          read once and never stored. Importing the same file twice is safe: we skip rows we already
          have.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">1. Your accounts</h2>
        <AccountList accounts={accounts} />
        <AddAccountForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">2. Upload statement files</h2>
        {accounts.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Add an account first.</p>
        ) : (
          <ImportForm
            accounts={accounts.map(({ id, name, kindLabel }) => ({ id, name, kindLabel }))}
          />
        )}
        <p className="text-xs text-zinc-500">
          Supported exports: Chase checking, savings and credit card.
        </p>
      </section>
    </>
  );
}

export default function ImportPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ImportContent />
      </Suspense>
    </main>
  );
}
