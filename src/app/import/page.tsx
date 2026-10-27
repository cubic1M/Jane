import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AddAccountForm } from "./add-account-form";
import { ImportForm } from "./import-form";
import { UploadHistory } from "./upload-history";
import { AppHeader } from "@/components/app-header";
import { AccountList } from "@/components/account-list";
import { listAccountSummaries } from "@/lib/accounts";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { balancesToAsk } from "@/lib/import/account-balance";
import { listUploads, uploadedTotals } from "@/lib/import/remove";
import { requireUser } from "@/lib/session";
import { LoadingBar } from "@/components/loading-bar";
import { BANK_DOWNLOADS, SUGGESTED_UPLOAD_MONTHS, UPLOAD_REASSURANCE } from "@/config/import";

async function ImportContent() {
  const user = await requireUser();
  if (!canImportCsv(user)) redirect("/connect");
  const db = await scopedDb();
  const [accounts, history, totals, uploaded, asks] = await Promise.all([
    listAccountSummaries(db),
    listUploads(db),
    uploadedTotals(db),
    db.accounts.findMany({ where: { source: "csv" }, select: { id: true } }),
    balancesToAsk(db),
  ]);
  const uploadedIds = new Set(uploaded.map((a) => a.id));

  return (
    <>
      <AppHeader user={user} />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Upload your statements</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Download the last {SUGGESTED_UPLOAD_MONTHS} months of transactions from your bank&apos;s
          website as CSV, OFX or QFX, and upload them here. {UPLOAD_REASSURANCE}
        </p>
        <p data-reupload-safe="" className="text-zinc-600 dark:text-zinc-400">
          Uploading the same file again, or one that overlaps, is safe: Jane skips the rows it
          already has, so there&apos;s no need to remove anything first.
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
        <h2 className="text-xl font-semibold">Upload statement files</h2>
        {/* A first upload makes its account from the file, so nothing comes before it. */}
        <ImportForm
          accounts={accounts.map(({ id, name, kindLabel, kind }) => ({
            id,
            name,
            kindLabel,
            kind,
          }))}
        />
        <p className="text-xs text-zinc-500">
          Jane knows the CSV layouts of Chase, Bank of America, Wells Fargo, Capital One, Citi,
          American Express and Discover. For any other CSV you pick which column is which.
        </p>
      </section>

      <UploadHistory
        uploads={history.uploads}
        earlier={history.earlier}
        accounts={accounts
          .filter((a) => uploadedIds.has(a.id))
          .map((a) => ({
            id: a.id,
            name: a.name,
            rows: a.transactionCount,
            kindLabel: a.kindLabel,
            credit: a.kind === "credit_card",
            balanceCents: a.currentBalanceCents,
            firstDate: a.firstDate,
            lastDate: a.lastDate,
          }))}
        totals={totals}
        asks={asks}
      />

      <section className="flex flex-col gap-4">
        {/* Uploaded accounts are listed with their uploads above; linked banks here. */}
        {accounts.some((a) => !uploadedIds.has(a.id)) && (
          <>
            <h2 className="text-xl font-semibold">Linked accounts</h2>
            <AccountList accounts={accounts.filter((a) => !uploadedIds.has(a.id))} />
          </>
        )}
        <details data-add-account="">
          <summary className="cursor-pointer text-sm font-medium">Add an account by hand</summary>
          <div className="mt-3">
            <AddAccountForm />
          </div>
        </details>
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
