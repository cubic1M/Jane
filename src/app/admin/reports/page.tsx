import { Suspense } from "react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";
import { systemDb } from "@/lib/system-db";
import { recentTryFeedback } from "@/lib/try-feedback";
import { tryTotals } from "@/lib/try-stats";

// What beta testers reported (src/app/report-a-problem): their words, the page and when, newest first.
async function Reports() {
  const admin = await requireAdmin();
  const reports = await systemDb(
    "Admin page: works across people, behind ADMIN_EMAILS and two-factor",
  ).problemReport.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      path: true,
      message: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  });
  const [totals, feedback] = await Promise.all([tryTotals(), recentTryFeedback()]);
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Problem reports</h1>
      <section aria-labelledby="try-totals" className="flex flex-col gap-2">
        <h2 id="try-totals" className="text-xl font-semibold">
          Landing-page tries with a real statement
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Counts only. Sample tries aren&apos;t included, and a person can scan more than one file.
        </p>
        <table data-try-totals="" className="w-full max-w-lg text-left text-sm tabular-nums">
          <thead>
            <tr>
              <th scope="col" className="py-1 font-medium">
                What happened
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Last 7 days
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                All time
              </th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr
                key={t.event}
                data-try-total={t.event}
                className="border-t border-zinc-200 dark:border-zinc-800"
              >
                <th scope="row" className="py-1 font-normal">
                  {t.label}
                </th>
                <td className="py-1 text-right">{t.lastWeek}</td>
                <td className="py-1 text-right">{t.allTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="try-feedback" className="flex flex-col gap-2">
        <h2 id="try-feedback" className="text-xl font-semibold">
          What people said during a try
        </h2>
        {feedback.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {feedback.map((f) => (
              <li
                key={f.id}
                data-try-feedback-row={f.id}
                className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
              >
                <p className="break-words whitespace-pre-wrap">{f.message}</p>
                <p className="mt-1 text-zinc-500">
                  {f.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {f.path} ·{" "}
                  {f.kind === "statement" ? "their own statement" : "sample person"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <h2 className="text-xl font-semibold">From signed-in people</h2>
      {reports.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No reports yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <li
              key={r.id}
              data-problem-report={r.id}
              className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
            >
              <p className="break-words whitespace-pre-wrap">{r.message}</p>
              <p className="mt-1 text-zinc-500">
                {r.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {r.path} ·{" "}
                {r.user.email ?? "no email"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Reports />
      </Suspense>
    </main>
  );
}
