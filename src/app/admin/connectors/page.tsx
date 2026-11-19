import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { logAudit } from "@/lib/audit";
import { connectorStatus, type ConnectorStatus } from "@/lib/connectors/status";
import { momentLabel } from "@/lib/day-label";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { AdminTable } from "../admin-table";

// Every connector's state on one page (section C5, src/lib/connectors/status.ts): who it's open to,
// its key names set or missing (never a value), how many people have it connected, and its last good
// read and last failure. Like "what Plaid granted" on /admin/costs.

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";

const WHO: Record<string, string> = {
  off: "off (CONNECTORS)",
  killed: "killed",
  switched_off: "not in REAL_CONNECTORS",
  trial: "not for trials",
  sandbox_for_samples: "sample people only",
  real_for_real: "real people only",
  needs_review: "waits for human review",
  needs_counsel: "waits for counsel",
};
const who = (reason: string | null) => (reason === null ? "open" : (WHO[reason] ?? reason));
const when = (at: Date | null) =>
  at ? momentLabel(at, "America/Los_Angeles", { year: true }) : "never";

function Row(s: ConnectorStatus) {
  return {
    key: s.id,
    cells: [
      <span key="n" className="flex flex-col">
        <span>{s.name}</span>
        <span className={MUTED}>
          {s.id}
          {s.sandbox ? " (sandbox)" : ""}
        </span>
      </span>,
      who(s.realPeople),
      who(s.samplePeople),
      s.keys.length === 0
        ? "none needed"
        : s.keys.map((k) => `${k.name} ${k.set ? "set" : "missing"}`).join(", "),
      <span key="c" className="tabular-nums">
        {s.connected}
      </span>,
      when(s.lastRead),
      s.lastFailure ? `${when(s.lastFailure.at)}: ${s.lastFailure.reason}` : "none",
    ],
  };
}

async function Connectors() {
  const admin = await requireAdmin();
  const rows = await connectorStatus();
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_connectors", null, {});
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Connectors</h1>
      <p className={MUTED}>
        Who each one is open to now, by the same locks the app uses; key names set or missing, never
        a value (`npm run connectors:check` also asks each test environment); people connected; and
        its last good read and last failure across everyone.
      </p>
      <AdminTable
        data-connectors=""
        head={[
          "Connector",
          "Real people",
          "Sample people",
          "Keys",
          "Connected",
          "Last read",
          "Last failure",
        ]}
        rows={rows.map(Row)}
      />
    </>
  );
}

// Never kept in the browser's memory (src/lib/page-cache.ts): every admin view goes on the access log.
export const unstable_dynamicStaleTime = 0;

export default function ConnectorsAdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Connectors />
      </Suspense>
    </main>
  );
}
