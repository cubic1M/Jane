import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PLANNED_EVENT_KINDS } from "@/config/tax-years";
import { loadMultiYear } from "@/lib/multi-year";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { EventForm, PlanButton, RemoveButton, RetireForm } from "./forms";

// Tax moves over several years (spec step 220): the projection, the moves with their effect
// over the years (demo advice), and what the person has told Jane about their plans.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadMultiYear(user.id);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Taxes over the years</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your federal tax for each year ahead, from your {v.year} estimate and your plans. The
          first row is your estimate; the rest are projections.
        </p>
        <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          {v.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
      {v.advice && v.moves.length > 0 && (
        <section aria-labelledby="moves" className={CARD}>
          <h2 id="moves" className="text-xl font-semibold">
            Moves that save tax
          </h2>
          <ul className="flex flex-col gap-4">
            {v.moves.map((m) => (
              <li key={m.key} className="flex flex-col gap-2 text-sm">
                <strong>{m.title}</strong>
                <span>{m.why}</span>
                <span>Saves about {formatCents(m.effectCents)} of tax over the years.</span>
                <PlanButton moveKey={m.key} label={m.title} />
              </li>
            ))}
          </ul>
          <DemoAdviceLabel />
        </section>
      )}
      {v.advice && v.moves.length === 0 && (
        <p className="text-sm">I don&apos;t see a move worth making right now.</p>
      )}
      <section aria-labelledby="table" className={CARD}>
        <h2 id="table" className="text-xl font-semibold">
          Year by year
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-1 pr-3">Year</th>
                <th className="py-1 pr-3">Income</th>
                <th className="py-1 pr-3">Federal tax</th>
                <th className="py-1">Top rate</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.year}>
                  <td className="py-1 pr-3">
                    {r.year}
                    {r.year === v.year ? " (estimate)" : ""}
                  </td>
                  <td className="py-1 pr-3">{formatCents(r.incomeCents)}</td>
                  <td className="py-1 pr-3">{formatCents(r.totalTaxCents)}</td>
                  <td className="py-1">{Math.round(r.marginalRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm">
          About {formatCents(v.lifetimeTaxCents)} of federal tax across these years.
        </p>
      </section>
      <section aria-labelledby="plans" className={CARD}>
        <h2 id="plans" className="text-xl font-semibold">
          Your plans
        </h2>
        <RetireForm current={v.retireYear} />
        {v.events.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {v.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-1">
                <span>
                  {PLANNED_EVENT_KINDS[e.kind]}: {formatCents(e.amountCents)} in {e.year}
                </span>
                <RemoveButton id={e.id} label={`${e.kind} in ${e.year}`} />
              </li>
            ))}
          </ul>
        )}
        <h3 className="font-semibold">Add a bonus, a sale or a withdrawal you plan</h3>
        <EventForm />
      </section>
    </>
  );
}

export default function YearsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
