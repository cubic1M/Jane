import { Suspense } from "react";
import { launchChecks, launchReady } from "@/lib/launch-check";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";

// The production switch checklist, run against this deployment's own environment.
async function Launch() {
  const admin = await requireAdmin();
  const checks = launchChecks(process.env);
  const ready = launchReady(checks);
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Launch check</h1>
      <p
        className={`rounded-lg p-3 ${ready ? "bg-emerald-50 dark:bg-emerald-950" : "bg-amber-50 dark:bg-amber-950"}`}
      >
        {ready ? "Ready for outside users." : "Not ready for outside users yet."}
      </p>
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        {checks.map((c) => (
          <li key={c.name} className="flex flex-wrap justify-between gap-2 px-4 py-3">
            <span>
              <span className="font-semibold">{c.name}</span>
              <span className="text-zinc-600 dark:text-zinc-400"> · {c.detail}</span>
            </span>
            <span
              className={c.ok ? "text-emerald-700" : c.required ? "text-red-700" : "text-amber-700"}
            >
              {c.ok ? "Pass" : c.required ? "Fail" : "Optional"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function LaunchPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Launch />
      </Suspense>
    </main>
  );
}
