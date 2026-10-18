import { Suspense } from "react";
import { JOB_STALE_HOURS } from "@/config/health";
import { healthReport } from "@/lib/health";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";

const when = (date: Date | null) =>
  date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "never";

async function Health() {
  const admin = await requireAdmin();
  const report = await healthReport(admin);
  const count = (counts: Record<string, number>, key: string) => counts[key] ?? 0;

  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Health</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Daily jobs</h2>
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {report.jobs.map((job) => (
            <li key={job.name} className="flex flex-wrap justify-between gap-2 px-4 py-3">
              <span className="font-medium">{job.name}</span>
              <span
                className={job.missed || job.lastOk === false ? "font-semibold text-red-700" : ""}
              >
                {job.missed
                  ? `Missed: no good run in over ${JOB_STALE_HOURS} hours`
                  : job.lastOk === false
                    ? "Last run failed"
                    : job.lastRunAt
                      ? "OK"
                      : "Hasn't run yet"}{" "}
                · last run {when(job.lastRunAt)} · last good run {when(job.lastSuccessAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">Linked banks</h2>
          <p>
            {count(report.plaid.items, "active")} working ·{" "}
            {count(report.plaid.items, "login_required")} need sign-in ·{" "}
            {count(report.plaid.items, "error")} in error
          </p>
          <p className="text-zinc-600 dark:text-zinc-400">
            Last sync {when(report.plaid.lastSyncedAt)}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">Background jobs</h2>
          <p>
            {count(report.backgroundJobs, "queued")} waiting ·{" "}
            {count(report.backgroundJobs, "failed")} failed
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">Errors</h2>
          <p>{report.errorsLastDay} in the last day</p>
        </div>
      </section>
    </>
  );
}

export default function HealthPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Health />
      </Suspense>
    </main>
  );
}
