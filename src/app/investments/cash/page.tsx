import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import {
  CASH_HOMES,
  CASH_HOMES_SOURCE,
  CASH_RATES_AS_OF,
  CURRENT_CASH_RATE_SOURCE,
  EMERGENCY_MAX_REACH_DAYS,
} from "@/config/cash";
import { EMERGENCY_FUND_MONTHS } from "@/config/proposals";
import { loadCash } from "@/lib/investments/cash";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { canHoldEmergency } from "@/planning/cash";
import { moveNow } from "./actions";

// Cash done right (spec step 162, demo advice): where each dollar of cash sits and what it
// earns, the plan for it, and its moves, each a tap. The emergency fund stays in reach.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const DONE: Record<string, string> = {
  moved: "Done. It's moving through the stand-in (no real money moves).",
  changed: "Your cash changed since that plan. Here's the new one.",
};
const rate = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function CashContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/cash">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const view = await loadCash(user.id);
  const plan = view.plan;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Cash</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every dollar of cash with a job: a month of spending in checking, the emergency fund where
          it earns well and is in reach within {EMERGENCY_MAX_REACH_DAYS} days, and only the rest
          somewhere that pays a little more for being harder to reach.
        </p>
      </div>
      {typeof done === "string" && Object.hasOwn(DONE, done) && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {DONE[done]}
        </p>
      )}

      {view.places.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No checking, savings or brokerage cash linked yet.
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Where it is now</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="font-normal">Account</th>
                <th className="text-right font-normal">Balance</th>
                <th className="text-right font-normal">Earns (typical)</th>
              </tr>
            </thead>
            <tbody>
              {view.places.map((p) => (
                <tr key={`${p.id}-${p.kind}`}>
                  <td>{p.name}</td>
                  <td className="text-right">{formatCents(p.balanceCents)}</td>
                  <td className="text-right">{rate(p.rateBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-zinc-500">
            Rates are stand-ins as of {day(CASH_RATES_AS_OF)}: {CURRENT_CASH_RATE_SOURCE}.
          </p>
        </section>
      )}

      {view.advice && plan && (
        <section className="flex flex-col gap-3 rounded-xl border border-emerald-300 p-4 dark:border-emerald-800">
          <h2 className="text-xl font-semibold">The plan</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {plan.buckets.map((b) => (
              <li key={b.key} className="flex justify-between gap-2">
                <span>
                  {b.label}
                  {b.home ? `: ${b.home.name}, about ${rate(b.rateBps)}` : ""}
                  {b.key === "emergency"
                    ? view.emergencyFromGoal
                      ? " (your emergency fund goal)"
                      : ` (${EMERGENCY_FUND_MONTHS} months of your spending)`
                    : ""}
                </span>
                <span>{formatCents(b.cents)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            Cash earns about {formatCents(plan.nowYearlyCents)} a year now; set up like this, about{" "}
            {formatCents(plan.afterYearlyCents)}: {formatCents(plan.gainCents)} more a year, at
            these rates.
          </p>
          {plan.moves.length > 0 && <SimulatedBanner />}
          {plan.moves.map((m) => (
            <form key={m.key} action={moveNow} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="key" value={plan.key} />
              <input type="hidden" name="move" value={m.key} />
              <button type="submit" className={BUTTON}>
                {m.key === "checking_to_savings"
                  ? `Move ${formatCents(m.cents)} to ${m.toName}`
                  : `Put ${formatCents(m.cents)} in the money market fund`}
              </button>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                From {m.fromName}; about {formatCents(m.gainCents)} more a year.
              </span>
            </form>
          ))}
          <DemoAdviceLabel />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Where cash can earn more</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="font-normal">Home</th>
              <th className="text-right font-normal">Earns</th>
              <th className="text-right font-normal">In reach</th>
              <th className="text-right font-normal">Emergency fund?</th>
            </tr>
          </thead>
          <tbody>
            {CASH_HOMES.map((h) => (
              <tr key={h.key}>
                <td>
                  {h.name}
                  <span className="block text-xs text-zinc-500">{h.note}</span>
                </td>
                <td className="text-right">{rate(h.rateBps)}</td>
                <td className="text-right">
                  {h.reachDays <= EMERGENCY_MAX_REACH_DAYS
                    ? `${h.reachDays} ${h.reachDays === 1 ? "day" : "days"}`
                    : "At maturity"}
                </td>
                <td className="text-right">{canHoldEmergency(h) ? "Yes" : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.advice && plan && plan.ladder.length > 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Instead of the money market fund, the {formatCents(plan.buckets[2].cents)} beyond the
            emergency fund could go in a Treasury ladder:{" "}
            {plan.ladder
              .map((r) => `${formatCents(r.cents)} in ${r.months}-month bills`)
              .join(", ")}
            . Buying Treasuries needs a brokerage that sells them; the emergency fund never goes
            there.
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Stand-in rates as of {day(CASH_RATES_AS_OF)}: {CASH_HOMES_SOURCE}.
        </p>
      </section>
    </>
  );
}

export default function CashPage(props: PageProps<"/investments/cash">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <CashContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
