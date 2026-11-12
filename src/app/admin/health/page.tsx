import { Suspense } from "react";
import { JOB_STALE_HOURS } from "@/config/health";
import { healthReport } from "@/lib/health";
import { opsCounts } from "@/lib/ops-alerts";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";

const when = (date: Date | null) =>
  date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "never";

async function Health() {
  const admin = await requireAdmin();
  const report = await healthReport(admin);
  const now = new Date();
  // Counts only, no one's data (src/lib/ops-alerts.ts); viewing the page is audit-logged above.
  const [opsDay, opsWeek] = await Promise.all([
    opsCounts(new Date(now.getTime() - 24 * 3_600_000), { now }),
    opsCounts(new Date(now.getTime() - 7 * 24 * 3_600_000), { now }),
  ]);
  const count = (counts: Record<string, number>, key: string) => counts[key] ?? 0;
  const rlsWhole = report.rls.ok && report.rls.switchWorks;

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

      <section className="flex flex-col gap-2" aria-labelledby="rls-heading">
        <h2 id="rls-heading" className="text-xl font-semibold">
          Row-level security
        </h2>
        {/* A gap shows like the site's errors, in words and weight (the design is monochrome). */}
        <p
          className={
            rlsWhole
              ? "text-sm"
              : "self-start border-2 border-current px-2 py-1 text-sm font-semibold"
          }
          role={rlsWhole ? undefined : "alert"}
          data-testid="rls-coverage"
        >
          {rlsWhole ? "" : "[ERROR] "}
          {report.rls.ok
            ? `On: ${report.rls.tables.length} of ${report.rls.tables.length} user-owned tables covered`
            : !report.rls.role
              ? "Off: the database has no jane_rls role"
              : `Gap: ${report.rls.missing.length} of ${report.rls.tables.length} user-owned tables not covered (${report.rls.missing.join(", ")})`}
          {" · "}
          {report.rls.switchWorks ? "this server switches to it" : "this server can't switch to it"}
        </p>
        <p className="text-sm" data-testid="deny-by-default">
          {report.rls.login.denied
            ? `Deny by default: on. This server logs in as ${report.rls.login.login}, which can use no table by itself`
            : `Deny by default: off. This server logs in as ${report.rls.login.login}, which can use every table by itself`}
          {" · "}
          {report.rls.systemSwitch
            ? "system queries switch to jane_system"
            : "system queries can't switch to jane_system"}
        </p>
        <details className="rounded-xl border border-zinc-200 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-3 font-medium">Every table</summary>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {report.rls.tables.map((t) => (
              <li key={t.table} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span className="font-mono">{t.table}</span>
                <span className={t.ok ? "" : "font-semibold"}>
                  {t.ok ? "●" : "○"} RLS {t.rls ? "on" : "off"} · {t.policies}{" "}
                  {t.policies === 1 ? "policy" : "policies"}
                  {t.personPolicy ? "" : " · no per-person policy"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
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

      <section className="flex flex-col gap-2" aria-labelledby="ops-heading" data-ops-alarms="">
        <h2 id="ops-heading" className="text-xl font-semibold">
          Beta alarms
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign-in emails and Plaid webhook failures email the team at once; everything here is in
          one daily email, sent only on a day something happened.
        </p>
        {opsWeek.length === 0 ? (
          <p className="text-sm">Nothing in the last 7 days.</p>
        ) : (
          <table className="w-full text-left text-sm tabular-nums">
            <thead>
              <tr>
                <th scope="col" className="py-1 font-medium">
                  What happened
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Last day
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Last 7 days
                </th>
              </tr>
            </thead>
            <tbody>
              {opsWeek.map((o) => (
                <tr key={o.kind} className="border-t border-zinc-200 dark:border-zinc-800">
                  <th scope="row" className="py-1 font-normal">
                    {o.label}
                    {o.codes.length > 0 && (
                      <span className="block text-xs text-zinc-500">{o.codes.join(", ")}</span>
                    )}
                  </th>
                  <td className="py-1 text-right">
                    {opsDay.find((d) => d.kind === o.kind)?.count ?? 0}
                  </td>
                  <td className="py-1 text-right">{o.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// Never kept in the browser's memory (src/lib/page-cache.ts). Every admin view goes on the access log, which a page kept in memory wouldn't reach.
export const unstable_dynamicStaleTime = 0;

export default function HealthPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Health />
      </Suspense>
    </main>
  );
}
