import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { AddAccountForm } from "./add-account-form";
import { ImportForm } from "./import-form";
import { accountKindOf } from "@/data-sources/types";
import { UploadHistory } from "./upload-history";
import { AppHeader, PageLoading } from "@/components/app-header";
import { AccountList } from "@/components/account-list";
import { listAccountSummaries } from "@/lib/accounts";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { balancesToAsk } from "@/lib/import/account-balance";
import { listUploads, uploadedTotals } from "@/lib/import/remove";
import { requireUser } from "@/lib/session";
import { BANK_DOWNLOADS, SUGGESTED_UPLOAD_MONTHS, UPLOAD_REASSURANCE } from "@/config/import";

async function ImportContent() {
  const user = await requireUser();
  if (!canImportCsv(user)) redirect("/connect");
  const db = await scopedDb();
  const [accounts, history, totals, uploaded, asks, linkedRows] = await Promise.all([
    listAccountSummaries(db),
    listUploads(db),
    uploadedTotals(db),
    db.accounts.findMany({ where: { source: "csv" }, select: { id: true } }),
    balancesToAsk(db),
    // A linked bank's accounts, by institution and last four: a file from one of them would
    // count it twice.
    db.accounts.findMany({
      where: { source: "plaid" },
      select: {
        name: true,
        mask: true,
        type: true,
        subtype: true,
        item: { select: { institutionName: true } },
      },
    }),
  ]);
  const linked = linkedRows.map((a) => ({
    name: a.name,
    institution: a.item?.institutionName ?? null,
    mask: a.mask,
    kind: accountKindOf(a.type, a.subtype),
  }));
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
          already has.
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
        {/* A first upload makes its account from the file, so nothing comes before it. Only
            uploaded accounts take files: a linked bank's are filled by the bank (round 9 of the
            new-user passes: the page opened on "Demo Checking", and Import then failed). */}
        <ImportForm
          accounts={accounts
            .filter((a) => uploadedIds.has(a.id))
            .map(({ id, name, kindLabel, kind }) => ({ id, name, kindLabel, kind }))}
          linked={linked}
        />
        <p className="text-xs text-zinc-500">
          Jane knows the CSV layouts of Chase, Bank of America, Wells Fargo, Capital One, Citi,
          American Express, Discover, Apple Card, U.S. Bank, Ally and Schwab, and Venmo and PayPal
          statements. For any other CSV you pick which column is which.
        </p>
      </section>

      {/* Holdings files have their own page: one upload form per page (src/app/import/investments). */}
      <p data-positions-link="" className="text-sm text-zinc-600 dark:text-zinc-400">
        Have a brokerage or retirement account?{" "}
        <Link href="/import/investments" className="font-semibold underline">
          Upload your investments
        </Link>{" "}
        from Fidelity, Schwab, Vanguard or Robinhood.
      </p>

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
      <Suspense fallback={<PageLoading />}>
        <ImportContent />
      </Suspense>
    </main>
  );
}
