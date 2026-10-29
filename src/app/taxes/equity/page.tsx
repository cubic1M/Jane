import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { EQUITY_EVENT_KINDS } from "@/config/equity-tax";
import { dayLabel } from "@/lib/day-label";
import { loadEquityTax } from "@/lib/equity-tax";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { AsideButton, EventForm, RemoveButton } from "./forms";

// Crypto and equity pay (spec step 219): the tax on each, what to set aside (demo advice).

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadEquityTax(user.id);
  const c = v.cryptoYear;
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Crypto and equity pay</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The tricky income, worked out for {v.year} and in your estimate. The holding-period and
          alternative minimum tax rules are in Jane&apos;s config with their sources.
        </p>
      </div>
      <section aria-labelledby="crypto" className={CARD}>
        <h2 id="crypto" className="text-xl font-semibold">
          Crypto
        </h2>
        {v.income.crypto.holdings.length === 0 && v.income.crypto.yearSales.length === 0 ? (
          <p className="text-sm">
            No exchange connected.{" "}
            <Link href="/investments/crypto" className={LINK}>
              Connect one
            </Link>{" "}
            and Jane works out the gains by lot.
          </p>
        ) : (
          <>
            <p className="text-sm">
              Sold in {v.year}: {formatCents(c.proceedsCents)} in, {formatCents(c.costCents)} cost
              by lot ({formatCents(c.shortTermCents)} short-term, {formatCents(c.longTermCents)}{" "}
              long-term gain).
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {v.income.crypto.holdings.map((h) => (
                <li
                  key={`${h.connection}${h.asset}`}
                  className="flex flex-wrap justify-between gap-x-3"
                >
                  <span>
                    {h.asset} on {h.connection}: {formatCents(h.valueCents)} (cost{" "}
                    {formatCents(h.basisCents)})
                  </span>
                  <span>
                    {h.gainCents < 0 ? "−" : ""}
                    {formatCents(Math.abs(h.gainCents))} unrealised
                  </span>
                </li>
              ))}
            </ul>
            {v.forms1099DA.map((f) => (
              <p key={f.exchange} className="text-sm">
                1099-DA from {f.exchange}:{" "}
                {f.status === "waiting"
                  ? "waiting for it"
                  : f.status === "differs"
                    ? "doesn't match your sales (not used)"
                    : "collected"}
                .
              </p>
            ))}
          </>
        )}
      </section>
      <section aria-labelledby="events" className={CARD}>
        <h2 id="events" className="text-xl font-semibold">
          RSUs, ESPP and options
        </h2>
        {v.income.events.length === 0 && <p className="text-sm">None added yet.</p>}
        <ul className="flex flex-col gap-3 text-sm">
          {v.income.events.map((e) => (
            <li key={e.event.id} className="flex flex-col gap-1">
              <strong>
                {EQUITY_EVENT_KINDS[e.event.kind]}: {e.event.shares} {e.event.company} shares,{" "}
                {dayLabel(e.event.occurredOn, { year: true })}
              </strong>
              {e.espp && (
                <span>
                  {e.espp.qualifying
                    ? "Qualifying sale: most of the gain is long-term."
                    : `Disqualifying sale: ${formatCents(e.espp.ordinaryCents)} is ordinary income.`}
                </span>
              )}
              {e.iso && e.iso.preferenceCents > 0 && (
                <span>
                  {formatCents(e.iso.preferenceCents)} counts toward the alternative minimum tax.
                </span>
              )}
              <RemoveButton id={e.event.id} label={`${e.event.company} ${e.event.kind}`} />
            </li>
          ))}
        </ul>
        {v.rsu.map((r) => (
          <p key={r.id} className="text-sm">
            {r.company} vest: {formatCents(r.incomeCents)} of income, {formatCents(r.withheldCents)}{" "}
            withheld ({Math.round(r.rateWithheld * 100)}%)
            {r.shortfallCents > 0
              ? `, ${formatCents(r.shortfallCents)} short at your rate.`
              : ", which covers it."}
          </p>
        ))}
        {v.amtCents > 0 && (
          <p className="text-sm">
            Alternative minimum tax from your options: about {formatCents(v.amtCents)}.
          </p>
        )}
        <h3 className="font-semibold">Add one</h3>
        <EventForm />
      </section>
      {v.advice && v.setAside.cents > 0 && (
        <section aria-labelledby="aside" className={CARD}>
          <h2 id="aside" className="text-xl font-semibold">
            What to set aside
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {v.setAside.parts.map((p) => (
              <li key={p.label}>
                {p.label}: about {formatCents(p.cents)}
              </li>
            ))}
          </ul>
          <p className="text-sm">About {formatCents(v.setAside.cents)} in all.</p>
          {v.setAside.goalStarted ? (
            <p className="text-sm">Your goal &quot;{v.setAside.goalName}&quot; is started.</p>
          ) : (
            <AsideButton label={`Start a goal for ${formatCents(v.setAside.cents)}`} />
          )}
          <DemoAdviceLabel />
        </section>
      )}
    </>
  );
}

export default function EquityPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
