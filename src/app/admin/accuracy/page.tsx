import { ACCURACY_CHECKS, latestAccuracy } from "@/lib/invariants/accuracy";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";

// Beta accuracy: the latest daily run of the checks on real people's figures
// (src/lib/invariants/accuracy.ts). Counts by check only, as the run stored them: no person, amount
// or merchant is on this page, and opening it runs nothing.

// Never kept in the browser's memory (src/lib/page-cache.ts).
export const unstable_dynamicStaleTime = 0;

export default async function AccuracyPage() {
  const admin = await requireAdmin();
  const latest = await latestAccuracy();
  const about = new Map(ACCURACY_CHECKS.map((c) => [c.name, c.about]));
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Accuracy</h1>
      {!latest ? (
        <p className="text-sm">The daily accuracy checks haven&apos;t run yet.</p>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="accuracy-run">
            {latest.summary.checked} of {latest.summary.people} real people checked
            {latest.summary.errored > 0 ? `, ${latest.summary.errored} threw` : ""} · run at{" "}
            {latest.at.toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {latest.summary.checks.map((check) => (
              <li key={check.name} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono font-medium">{check.name}</span>
                  <span className={check.failed > 0 ? "font-semibold" : ""}>
                    {check.failed > 0 ? "[FAIL] " : ""}
                    {check.passed} passed · {check.failed} failed · {check.notApplicable} not
                    applicable
                  </span>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400">{about.get(check.name)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
