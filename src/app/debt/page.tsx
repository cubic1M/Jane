import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { MAX_DEBT_EXTRA_CENTS } from "@/config/debt";
import { MAX_PLANNER_CARDS } from "@/config/planning";
import { loadPayoff } from "@/lib/debt-plan";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { PLANNER_COPY } from "@/planning/debt-copy";
import { DebtPlanner } from "./planner";
import { YourPlan } from "./your-plan";

// The payoff planner (spec step 20), extended to every debt (spec step 110): the plan
// across every loan, card and buy now, pay later plan Jane knows about, and below it the
// planner to try other numbers, prefilled with the same debts.

async function Planner({ searchParams }: { searchParams: PageProps<"/debt">["searchParams"] }) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : "";
  };
  const typed = one("extra") ? parseMoneyToCents(one("extra")) : null;
  const extraCents =
    typed !== null && typed >= 0 && typed <= MAX_DEBT_EXTRA_CENTS ? typed : undefined;
  const payoff = await loadPayoff(user.id, { extraCents });
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const leftOutMortgage = payoff.summary.leftOut.some((l) => l.reason === "mortgage");
  // Every debt the plan uses, then the ones still missing a rate or payment to fill in.
  const planned = new Set(payoff.summary.cards.map((c) => c.id));
  const byKey = new Map(payoff.book.debts.map((d) => [d.key, d]));
  const fromBank = (key: string) =>
    byKey.get(key)?.aprFrom === "bank" && byKey.get(key)?.paymentFrom === "bank";
  const missing = payoff.book.debts.filter(
    (d) => !planned.has(d.key) && d.kind !== "mortgage" && (d.balanceCents ?? 0) > 0,
  );

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="debt_planner_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{PLANNER_COPY.title}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{PLANNER_COPY.intro}</p>
      </div>
      <YourPlan payoff={payoff} asOf={asOf} saved={one("saved")} error={one("error")} />
      {leftOutMortgage && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {PLANNER_COPY.mortgageLeftOut}{" "}
          <Link href="/loans" className="font-medium text-emerald-700 hover:underline">
            See your loans
          </Link>
        </p>
      )}
      <DebtPlanner
        cards={[
          ...payoff.summary.cards.map((c) => ({
            id: c.id,
            name: c.name,
            balanceCents: c.balanceCents,
            aprBps: c.aprBps,
            minimumCents: c.minimumCents,
            fromBank: fromBank(c.id),
          })),
          ...missing.map((d) => ({
            id: d.key,
            name: d.name,
            balanceCents: d.balanceCents ?? 0,
            aprBps: d.aprBps,
            minimumCents: d.paymentCents,
            fromBank: false,
          })),
        ].slice(0, MAX_PLANNER_CARDS)}
        unknown={payoff.book.debts
          .filter((d) => d.balanceCents === null && d.kind !== "mortgage")
          .map((d) => d.name)}
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

export default function DebtPage({ searchParams }: PageProps<"/debt">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Planner searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
