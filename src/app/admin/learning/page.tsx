import { connection } from "next/server";
import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { ACT_PRIOR_RATE, PAYOFF_PRIOR_RATE, PRIOR_WEIGHT } from "@/config/suggestions";
import { kindReport } from "@/lib/learning";
import { formatCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { AdminTable } from "../admin-table";
import { formatPercent as pct } from "@/lib/percent";

// The learning loop, kind by kind: how often each kind of suggestion is acted on when shown,
// how often what was acted on showed up in the transactions, and what that does to its rank.
// Everyone but trial people, counts only.

const MUTED = "text-zinc-600 dark:text-zinc-400";

async function Learning() {
  const admin = await requireAdmin();
  await connection();
  const { rows, updatedAt } = await kindReport();
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Learning</h1>
      <p className={MUTED}>
        What people do with each kind of suggestion, and what it does to its rank. Rates start at a
        prior ({pct(ACT_PRIOR_RATE)} acted on, {pct(PAYOFF_PRIOR_RATE)} paying off) worth{" "}
        {PRIOR_WEIGHT} showings, so a kind with little history stays near ×1.00. Trial people never
        count.
        {updatedAt ? ` Rebuilt ${updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` : ""}
      </p>
      {rows.length === 0 ? (
        <p className={MUTED}>Nothing shown yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <AdminTable
            data-learning-table=""
            className="tabular-nums"
            head={[
              "Kind",
              "Shown",
              "Acted on",
              "Said no",
              "Checked",
              "Paid off",
              "Confirmed",
              "Rank",
            ]}
            rows={rows.map((r) => ({
              key: r.topic,
              cells: [
                r.topic,
                r.shown,
                <>
                  {r.acted} <span className={MUTED}>({pct(r.actRate)})</span>
                </>,
                r.declined,
                r.decided,
                <>
                  {r.paidOff} <span className={MUTED}>({pct(r.payoffRate)})</span>
                </>,
                formatCents(r.confirmedCents),
                <>
                  ×{r.factor.toFixed(2)}
                  {r.saysPeople ? "" : <span className={MUTED}> · card quiet</span>}
                </>,
              ],
            }))}
          />
        </div>
      )}
      <p className={`text-sm ${MUTED}`}>
        Acted on: a yes or a Mark done. Checked: acted on with something the transactions can show,
        and watched to the end. Paid off: confirmed or partly confirmed. Card quiet: shown too few
        times for its card to say how often people act on it.
      </p>
    </>
  );
}

export default function AdminLearningPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Learning />
      </Suspense>
    </main>
  );
}
