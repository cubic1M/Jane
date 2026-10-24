import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { SHORT_TERM_RATES_AS_OF, SHORT_TERM_RATES_SOURCE } from "@/config/short-term";
import { loadShortTerm } from "@/lib/investments/short-term";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { buildLadder } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Short-term money, placed safely (spec step 234, demo advice): money needed within three
// years, compared after tax in the person's own state, with a Treasury bill ladder that
// matures when the money is needed. Nothing is locked past the date.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/short-term">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadShortTerm(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Short-term money, placed safely</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Money you need within three years, compared after tax at your {Math.round(v.fed * 100)}%
          federal and {Math.round(v.state * 100)}% state rate
          {v.fromProfile ? "" : " (assumed; fill in your tax profile for yours)"}. Treasury interest
          is free of state tax. Rates are stand-ins as of {day(SHORT_TERM_RATES_AS_OF)}:{" "}
          {SHORT_TERM_RATES_SOURCE}.
        </p>
      </div>
      {done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "started"
            ? "Started in the stand-in: no real bills are bought."
            : "That changed since you last looked."}
        </p>
      )}
      {v.candidates.length === 0 && v.ladders.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          No goal due within three years with money saved, and no emergency money above its floor.
        </p>
      )}
      {v.candidates.map((c) => (
        <section
          key={c.key}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">
            {c.name}: {formatCents(c.amountCents)}, needed by {day(c.endsOn)}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="font-normal">Where</th>
                <th className="text-right font-normal">After tax</th>
                <th className="text-right font-normal">A year</th>
              </tr>
            </thead>
            <tbody>
              {c.options.map((o) => (
                <tr key={o.product.key}>
                  <td>
                    {o.product.name}
                    <span className="block text-xs text-zinc-500">{o.product.note}</span>
                  </td>
                  <td className="text-right">{pct(o.afterTaxBps)}</td>
                  <td className="text-right">{formatCents(o.yearlyCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-zinc-500">
            Only places that can&apos;t lock your money past {day(c.endsOn)} are listed.
          </p>
          {v.advice && c.ladder && !c.hasLadder && (
            <form action={buildLadder} className="flex flex-col gap-2">
              <input type="hidden" name="key" value={c.key} />
              <p className="text-sm">
                A ladder of {c.ladder.length} {c.ladder.length === 1 ? "rung" : "rungs"} of Treasury
                bills, each maturing by {day(c.endsOn)} and rolling into the next bill until then:
                about {formatCents(c.gainCents)} a year more than savings, after tax.
              </p>
              <SimulatedBanner />
              <SubmitButton className={`${BUTTON} self-start`}>Build the ladder</SubmitButton>
              <DemoAdviceLabel />
            </form>
          )}
          {c.hasLadder && <p className="text-sm">A ladder is already running for this.</p>}
        </section>
      ))}
      {v.ladders.map((l) => (
        <section
          key={l.id}
          className="flex flex-col gap-2 rounded-xl border border-emerald-300 p-4 dark:border-emerald-800"
        >
          <h2 className="text-xl font-semibold">
            Ladder: {l.name}, {formatCents(l.amountCents)}
          </h2>
          <p className="text-sm">
            {l.status === "active"
              ? `Cash on ${day(l.endsOn)}.`
              : "Matured: the money is cash again."}
          </p>
          <ul className="list-disc pl-5 text-sm">
            {l.rungs.map((r, i) => (
              <li key={i}>
                {formatCents(r.amountCents)}:{" "}
                {r.bills.length === 0
                  ? "in savings"
                  : r.bills.map((b) => `${b.term}-month bill`).join(", then ")}
                {l.status === "active" && l.now[i]?.term
                  ? ` (now in a ${l.now[i].term}-month bill, matures ${day(l.now[i].maturesOn)})`
                  : ""}
              </li>
            ))}
          </ul>
          {l.events.length > 0 && (
            <p className="text-xs text-zinc-500">{l.events.length} rolled over so far.</p>
          )}
        </section>
      ))}
    </>
  );
}

export default function ShortTermPage(props: PageProps<"/investments/short-term">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
