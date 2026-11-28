import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { logAudit } from "@/lib/audit";
import { momentLabel } from "@/lib/day-label";
import { dayWords, historyForTeam } from "@/lib/plaid/history";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { AdminTable } from "../admin-table";

// How far back each linked bank's history goes, per link (src/lib/plaid/history.ts): the day it was
// linked, the days asked for, the oldest and newest transaction held and how many, Plaid's own word on
// the history (transactions_update_status), the last good sync, the last time the cursor moved and
// the last webhook codes. Counts and days only; nothing is shown that could be a token or an account number.

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
const when = (at: Date | string | null) =>
  at ? momentLabel(new Date(at), "America/Los_Angeles", { year: true }) : "never";

async function History() {
  const admin = await requireAdmin();
  const rows = await historyForTeam();
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_history", null, {
    count: rows.length,
  });
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Bank history</h1>
      <p className={MUTED}>
        One row per linked bank. Status is Plaid&apos;s own word at the last sync (NOT_READY,
        INITIAL_UPDATE_COMPLETE, HISTORICAL_UPDATE_COMPLETE); &quot;stuck&quot; means it was not
        complete after the nightly job&apos;s weeks of asking. &quot;Offer&quot; means the person is
        shown the one-tap full history.
      </p>
      <AdminTable
        data-bank-history=""
        head={[
          "Bank",
          "Linked",
          "Days asked",
          "Oldest held",
          "Newest",
          "Rows",
          "Plaid status",
          "Last sync",
          "Cursor moved",
          "Read again",
          "Webhooks",
          "Flags",
        ]}
        rows={rows.map((h) => ({
          key: h.itemId,
          cells: [
            <span key="b" className="flex flex-col">
              <span>{h.bank}</span>
              <span className={MUTED}>{h.userId.slice(0, 8)}</span>
            </span>,
            when(h.linkedAt),
            h.note?.daysRequested ? String(h.note.daysRequested) : "not yet noted",
            h.held.earliest ? dayWords(h.held.earliest) : "none",
            h.held.latest ? dayWords(h.held.latest) : "none",
            <span key="n" className="tabular-nums">
              {h.held.count}
            </span>,
            h.note?.status ?? "not yet noted",
            when(h.lastSyncedAt),
            when(h.note?.cursorMovedAt ?? null),
            when(h.note?.rescannedAt ?? null),
            h.webhookCodes.length > 0 ? h.webhookCodes.join(", ") : "none in 7 days",
            [
              h.stuck ? "stuck" : null,
              h.offer ? "offer" : null,
              h.note?.rereadHeld ? `re-read held back (${h.note.rereadHeld})` : null,
            ]
              .filter(Boolean)
              .join(", ") || "none",
          ],
        }))}
      />
    </>
  );
}

// Never kept in the browser's memory (src/lib/page-cache.ts): every admin view goes on the access log.
export const unstable_dynamicStaleTime = 0;

export default function HistoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <History />
      </Suspense>
    </main>
  );
}
