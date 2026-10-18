import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { MAX_PLANNER_CARDS } from "@/config/planning";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { PLANNER_COPY } from "@/planning/debt-copy";
import { DebtPlanner } from "./planner";

async function Planner() {
  const user = await requireUser();
  const db = await scopedDb();
  const cards = await db.accounts.findMany({
    where: { type: "credit" },
    select: { id: true, name: true, mask: true, currentBalanceCents: true },
    orderBy: { name: "asc" },
    take: MAX_PLANNER_CARDS,
  });
  const now = new Date();

  return (
    <>
      <AppHeader email={user.email} />
      <ViewTracker event="debt_planner_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{PLANNER_COPY.title}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{PLANNER_COPY.intro}</p>
      </div>
      <DebtPlanner
        cards={cards.map((c) => ({
          id: c.id,
          name: c.mask ? `${c.name} ····${c.mask}` : c.name,
          // Card balances are what's owed; a credit (negative) balance owes nothing.
          balanceCents: Math.max(0, c.currentBalanceCents ?? 0),
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
