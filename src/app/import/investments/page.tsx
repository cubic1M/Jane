import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PositionsForm } from "./positions-form";
import { AppHeader, PageLoading } from "@/components/app-header";
import { UPLOAD_REASSURANCE } from "@/config/import";
import { BROKER_DOWNLOADS } from "@/config/positions-import";
import { canImportCsv } from "@/lib/csv-access";
import { requireUser } from "@/lib/session";

// Uploading a brokerage's positions download: what each investment account holds, for the
// investments page, net worth and the investing checks (src/lib/import/positions.ts).

async function InvestmentsUploadContent() {
  const user = await requireUser();
  if (!canImportCsv(user)) redirect("/connect");
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Upload your investments</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Download your positions from your brokerage as CSV and upload them here. Jane shows what
          each account holds and its value. A newer download replaces the last one.{" "}
          {UPLOAD_REASSURANCE}
        </p>
      </div>
      <details
        data-broker-steps=""
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <summary className="cursor-pointer font-semibold">Where to find the download</summary>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          {BROKER_DOWNLOADS.map(({ broker, steps }) => (
            <li key={broker}>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{broker}:</span>{" "}
              {steps}
            </li>
          ))}
        </ul>
      </details>
      <PositionsForm />
      <p className="text-sm">
        <Link href="/import" className="underline">
          Upload bank and card statements instead
        </Link>
      </p>
    </>
  );
}

export default function InvestmentsUploadPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <Suspense fallback={<PageLoading />}>
        <InvestmentsUploadContent />
      </Suspense>
    </main>
  );
}
