import Link from "next/link";
import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { ACCESS_EVENTS } from "@/config/access-log";
import { parseFilters, searchAccessLog, type AccessFilters } from "@/lib/access-log";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { AdminTable } from "../admin-table";

// The access log (docs/security/edge.md): sign-ins, failed sign-ins, two-factor and bank-link
// changes, data downloads, deletions and every admin view and action, filterable. Viewing it
// is itself logged, like every admin page (src/proxy.ts).

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const field = "rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700";

function pageLink(filters: AccessFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.event) params.set("event", filters.event);
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.ip) params.set("ip", filters.ip);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.from) params.set("from", filters.from.toISOString().slice(0, 10));
  if (filters.to) params.set("to", filters.to.toISOString().slice(0, 10));
  params.set("page", String(page));
  return `/admin/access-log?${params}`;
}

async function AccessLog({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin();
  const filters = parseFilters(await searchParams);
  const { entries, more } = await searchAccessLog(filters);
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Access log</h1>
      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Event
          <select name="event" defaultValue={filters.event ?? ""} className={field}>
            <option value="">Any</option>
            {ACCESS_EVENTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Person (id or email)
          <input name="actor" defaultValue={filters.actor ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          IP
          <input name="ip" defaultValue={filters.ip ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          Outcome
          <select name="outcome" defaultValue={filters.outcome ?? ""} className={field}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          From
          <input type="date" name="from" defaultValue={day(filters.from)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input type="date" name="to" defaultValue={day(filters.to)} className={field} />
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Filter
        </button>
      </form>
      {entries.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No entries match.</p>
      ) : (
        <div className="overflow-x-auto">
          <AdminTable
            aria-label="Access log entries"
            head={["Time (UTC)", "Event", "Who", "Outcome", "IP", "Where", "Device", "Detail"]}
            rows={entries.map((e) => ({
              key: e.id,
              cells: [
                e.at.toISOString().replace("T", " ").slice(0, 19),
                e.event,
                <span key="who" className="break-all">
                  {e.actor}
                  {e.target && e.target !== e.actor ? ` → ${e.target}` : ""}
                </span>,
                e.outcome ?? "",
                e.ip ?? "",
                e.place ?? "",
                e.device,
                e.detail ?? "",
              ],
            }))}
          />
        </div>
      )}
      <nav className="flex gap-4 text-sm">
        {filters.page > 1 && <Link href={pageLink(filters, filters.page - 1)}>‹ Newer</Link>}
        {more && <Link href={pageLink(filters, filters.page + 1)}>Older ›</Link>}
      </nav>
    </>
  );
}

export default function AccessLogPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <AccessLog searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
