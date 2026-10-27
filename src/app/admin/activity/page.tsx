import Link from "next/link";
import { Suspense } from "react";
import { loadActivityOverview } from "@/lib/activity/admin";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { AdminTable } from "../admin-table";
import { LoadingBar } from "@/components/loading-bar";

// The beta's activity log (src/lib/activity/): who used Jane and when, and how far each got.
// Pages and buttons only, never what anyone typed. Every view is in the audit log.

const percent = (value: number | null) => (value === null ? "" : `${Math.round(value * 100)}%`);
const when = (at: Date | null) =>
  at ? `${at.toISOString().replace("T", " ").slice(0, 16)} UTC` : "Not seen yet";

async function Activity() {
  const admin = await requireAdmin();
  const { people, funnel, landingViews } = await loadActivityOverview(admin);
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Real beta users only: not admins, trials or the demo bank. Pages and buttons, never what
        anyone typed. {landingViews} anonymous landing page views in the last 7 days.
      </p>

      <section aria-labelledby="funnel-title" className="flex flex-col gap-3">
        <h2 id="funnel-title" className="text-xl font-semibold">
          Funnel
        </h2>
        <ol className="flex flex-col gap-2" data-funnel="">
          {funnel.map((step) => (
            <li key={step.name} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="font-medium">{step.name}</span>
              <span>
                {step.people} {step.people === 1 ? "person" : "people"}
                {step.ofPrevious !== null && (
                  <span className="text-zinc-500">
                    {" "}
                    · {percent(step.ofPrevious)} of the step before
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="people-title" className="flex flex-col gap-3">
        <h2 id="people-title" className="text-xl font-semibold">
          People
        </h2>
        {people.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No beta users yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <AdminTable
              head={["Person", "Got to", "Last seen", "Visits", "Events"]}
              rows={people.map((p) => ({
                key: p.id,
                cells: [
                  <Link
                    key="p"
                    href={`/admin/activity/${p.id}`}
                    className="font-medium break-all hover:underline"
                  >
                    {p.email}
                  </Link>,
                  p.reached,
                  when(p.lastSeen),
                  p.visits,
                  p.events,
                ],
              }))}
            />
          </div>
        )}
      </section>
    </>
  );
}

export default function ActivityPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Activity />
      </Suspense>
    </main>
  );
}
