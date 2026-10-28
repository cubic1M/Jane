import { Suspense } from "react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";

// What beta testers reported (src/app/report-a-problem): their words, the page and when, newest first.
async function Reports() {
  const admin = await requireAdmin();
  const reports = await db.problemReport.findMany({
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
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Problem reports</h1>
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
