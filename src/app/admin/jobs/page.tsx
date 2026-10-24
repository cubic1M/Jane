import { Suspense } from "react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { retry } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const SHOWN = 50;
const when = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ");

async function Jobs() {
  const admin = await requireAdmin();
  const [counts, failed, waiting] = await Promise.all([
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
    db.job.findMany({
      where: { status: "failed" },
      orderBy: { updatedAt: "desc" },
      take: SHOWN,
      select: { id: true, kind: true, attempts: true, lastError: true, updatedAt: true },
    }),
    db.job.findMany({
      where: { status: { in: ["queued", "running"] }, attempts: { gt: 0 } },
      orderBy: { runAt: "asc" },
      take: SHOWN,
      select: { id: true, kind: true, status: true, attempts: true, runAt: true, lastError: true },
    }),
  ]);
  const count = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;

  return (
    <>
      <AdminNav email={admin.email} />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Slow work done in the background, like writing card text. Failures are retried with a
          growing wait; after five tries a job stops here for a person to look at.
        </p>
        <p className="text-sm">
          {count("queued")} queued · {count("running")} running · {count("done")} done ·{" "}
          {count("failed")} failed
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Failed</h2>
        {failed.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing failed.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failed.map((j) => (
              <li
                key={j.id}
                className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-3 text-sm [overflow-wrap:anywhere] dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {j.kind} · {j.attempts} tries · {when(j.updatedAt)} UTC
                  </span>
                  <form action={retry}>
                    <input type="hidden" name="jobId" value={j.id} />
                    <SubmitButton className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold dark:border-zinc-700">
                      Retry
                    </SubmitButton>
                  </form>
                </div>
                {j.lastError && (
                  <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {j.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Waiting to retry</h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing waiting.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {waiting.map((j) => (
              <li key={j.id} className="[overflow-wrap:anywhere]">
                {j.kind} · {j.status} · try {j.attempts + 1} at {when(j.runAt)} UTC
                {j.lastError && <span className="text-zinc-500"> · {j.lastError}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function JobsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Jobs />
      </Suspense>
    </main>
  );
}
