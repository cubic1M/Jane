import { Suspense } from "react";
import { logAudit } from "@/lib/audit";
import { betaCosts } from "@/lib/beta-costs";
import { formatCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";
import { CARD_TIGHT } from "@/components/card";

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";

// What the closed beta costs this month, on one page (src/lib/beta-costs.ts): Plaid's connected
// banks, Claude against its monthly cap, and the people using Jane. Counts only.
async function Costs() {
  const admin = await requireAdmin();
  const costs = await betaCosts();
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_costs", null, {});
  const { plaid, claude, people } = costs;
  const percent = Math.round(claude.share * 100);
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Costs, {costs.month}</h1>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-costs="">
        <div className={CARD_TIGHT} data-cost="plaid">
          <h2 className="font-semibold">Plaid</h2>
          <p className="text-2xl font-semibold tabular-nums">{plaid.billedThisMonth}</p>
          <p className={MUTED}>
            banks billed this month at most: {plaid.connected} connected now
            {plaid.removedThisMonth > 0 ? ` + ${plaid.removedThisMonth} removed this month` : ""}
          </p>
          <p className={MUTED}>
            {plaid.linkedThisMonth} linked this month · {plaid.needSignIn} need sign-in ·{" "}
            {plaid.withLiabilities} with Liabilities · {plaid.withInvestments} with Investments
          </p>
          <p className={MUTED}>
            Real banks only (not the demo bank or tries). The price per bank is on Plaid&apos;s
            dashboard, under Billing.
          </p>
        </div>
        <div className={CARD_TIGHT} data-cost="claude">
          <h2 className="font-semibold">Claude</h2>
          <p className="text-2xl font-semibold tabular-nums">
            {formatCents(Math.round(claude.spentCents))}
          </p>
          <p className={MUTED}>
            of {formatCents(claude.capCents)} this month ({percent}%)
          </p>
          <div
            role="meter"
            aria-label="Claude spend against the monthly cap"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, percent)}
            className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          >
            <div
              className="h-full bg-zinc-900 dark:bg-zinc-100"
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
          <p className={MUTED}>
            CHAT_MONTHLY_CAP_CENTS sets the cap. Past it, everyone gets answers from their data
            alone until the 1st.
          </p>
        </div>
        <div className={CARD_TIGHT} data-cost="people">
          <h2 className="font-semibold">Beta people</h2>
          <p className="text-2xl font-semibold tabular-nums">{people.activeThisMonth}</p>
          <p className={MUTED}>active this month · {people.activeThisWeek} in the last 7 days</p>
          <p className={MUTED}>
            {people.signedUp} signed up · {people.invited} invited
          </p>
          <p className={MUTED}>Not counted: the team, tries and the demo bank alone.</p>
        </div>
      </section>
    </>
  );
}

// Never kept in the browser's memory (src/lib/page-cache.ts). Every admin view goes on the access log, which a page kept in memory wouldn't reach.
export const unstable_dynamicStaleTime = 0;

export default function CostsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Costs />
      </Suspense>
    </main>
  );
}
