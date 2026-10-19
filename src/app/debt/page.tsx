import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { MAX_PLANNER_CARDS, PLANNER_LEFT_OUT_SUBTYPES } from "@/config/planning";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { PLANNER_COPY } from "@/planning/debt-copy";
import { DebtPlanner } from "./planner";

async function Planner() {
  const user = await requireUser();
  const db = await scopedDb();
  const [debts, leftOut] = await Promise.all([
    db.accounts.findMany({
      where: {
        OR: [
          { type: "credit" },
          { type: "loan", NOT: { subtype: { in: [...PLANNER_LEFT_OUT_SUBTYPES] } } },
        ],
      },
      select: {
        id: true,
        name: true,
        mask: true,
        currentBalanceCents: true,
        // Rates and minimums from Plaid Liabilities (spec step 65), never guessed.
        liability: { select: { aprBps: true, minimumPaymentCents: true } },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      take: MAX_PLANNER_CARDS,
    }),
    db.accounts.count({
      where: { type: "loan", subtype: { in: [...PLANNER_LEFT_OUT_SUBTYPES] } },
    }),
  ]);
  const now = new Date();

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="debt_planner_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{PLANNER_COPY.title}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{PLANNER_COPY.intro}</p>
      </div>
      {leftOut > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {PLANNER_COPY.mortgageLeftOut}{" "}
          <Link href="/loans" className="font-medium text-emerald-700 hover:underline">
            See your loans
          </Link>
        </p>
      )}
      <DebtPlanner
        cards={debts.map((c) => ({
          id: c.id,
          name: c.mask ? `${c.name} ····${c.mask}` : c.name,
          // Balances are what's owed; a credit (negative) balance owes nothing.
          balanceCents: Math.max(0, c.currentBalanceCents ?? 0),
          aprBps: c.liability?.aprBps ?? null,
          minimumCents: c.liability?.minimumPaymentCents ?? null,
        }))}
        startYear={now.getUTCFullYear()}
        startMonth={now.getUTCMonth()}
        maxCards={MAX_PLANNER_CARDS}
      />
      <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {PLANNER_COPY.disclaimer}
      </p>
    </>
  );
}

export default function DebtPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Planner />
      </Suspense>
    </main>
  );
}
