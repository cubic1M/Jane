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
import { LoadingBar } from "@/components/loading-bar";
import { BANK_DOWNLOADS, SUGGESTED_UPLOAD_MONTHS, UPLOAD_REASSURANCE } from "@/config/import";

async function ImportContent() {
  const user = await requireUser();
  if (!canImportCsv(user)) redirect("/connect");
  const db = await scopedDb();
  const accounts = await listAccountSummaries(db);

  return (
    <>
      <AppHeader user={user} />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Upload your statements</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Download the last {SUGGESTED_UPLOAD_MONTHS} months of transactions from your bank&apos;s
          website as CSV, OFX or QFX, and upload them here. {UPLOAD_REASSURANCE} Uploading the same
          file twice is safe: Jane skips rows it already has.
        </p>
      </div>

      <details
        data-bank-steps=""
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <summary className="cursor-pointer font-semibold">How to download from your bank</summary>
        <ul className="mt-3 flex flex-col gap-3">
          {BANK_DOWNLOADS.map(({ bank, steps }) => (
            <li key={bank}>
              <p className="font-medium">{bank}</p>
              <ol className="list-decimal pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </details>

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
          Jane knows the CSV layouts of Chase, Bank of America, Wells Fargo, Capital One, Citi,
          American Express and Discover. For any other CSV you pick which column is which.
        </p>
      </section>
    </>
  );
}

export default function ImportPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <Suspense fallback={<LoadingBar />}>
        <ImportContent />
      </Suspense>
    </main>
  );
}
