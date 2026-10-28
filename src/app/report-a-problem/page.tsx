import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { LoadingBar } from "@/components/loading-bar";
import { reportPath } from "@/lib/problem-reports";
import { requireUser } from "@/lib/session";
import { ReportForm } from "./report-form";

// "Report a problem" (closed beta), from the profile menu on every signed-in page and from the
// error pages: the person's own words and the page they were on. Nothing else is sent.
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
        <h1 className="text-3xl font-semibold tracking-tight">Report a problem</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Something wrong on <span className="font-medium">{from}</span>? Tell us in a few words.
          Only what you write and the page go to the founders, never your balances or transactions.
        </p>
      </div>
      <ReportForm from={from} />
    </>
  );
}

export default function ReportPage({ searchParams }: PageProps<"/report-a-problem">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
