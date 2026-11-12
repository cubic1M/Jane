import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { reportPath } from "@/lib/problem-reports";
import { requireUser } from "@/lib/session";
import { ReportForm } from "./report-form";

// "Send feedback" (closed beta), from the profile menu on every signed-in page (two taps) and from
// the error pages: the person's own words, the page they were on and, if they choose, a screenshot.
// Nothing else is sent.
async function Report({
  searchParams,
}: {
  searchParams: PageProps<"/report-a-problem">["searchParams"];
}) {
  const user = await requireUser();
  const from = reportPath((await searchParams).from);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Send feedback</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Something wrong, confusing or good on <span className="font-medium">{from}</span>? Tell us
          in a few words. Only what you write, the page and any screenshot you add go to the
          founders, never your balances or transactions.
        </p>
      </div>
      <ReportForm from={from} />
    </>
  );
}

export default function ReportPage({ searchParams }: PageProps<"/report-a-problem">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<PageLoading />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
