import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { VALUES_EXCLUSIONS, VALUES_THEMES } from "@/config/values";
import { loadValues } from "@/lib/investments/values";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { saveValues, switchFunds } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Investing by your values (spec step 236, demo advice): leave out fossil fuels, weapons or
// tobacco, or lean towards a theme, inside each kind of investment so the risk target holds.
// The cost in dollars and what it does to diversification are shown before anything moves.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const signed = (cents: number) => `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/values">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadValues(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Investing by your values</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{v.note}</p>
      </div>
      {done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "saved"
            ? "Saved. Nothing moved."
            : done === "switched"
              ? "Switched in the stand-in: no real trades are made."
              : "That changed since you last looked."}
        </p>
      )}
      <form action={saveValues} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="font-semibold">Leave out</legend>
          {Object.entries(VALUES_EXCLUSIONS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="excludes"
                value={key}
                defaultChecked={v.prefs.excludes.includes(key as never)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-semibold">Lean towards</legend>
          {Object.entries(VALUES_THEMES).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="themes"
                value={key}
                defaultChecked={v.prefs.themes.includes(key as never)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <SubmitButton className={`${BUTTON} self-start`}>Save my list</SubmitButton>
      </form>
      {v.advice && v.plan && (
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-xl font-semibold">What it would change</h2>
          {v.plan.switches.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {v.plan.skipped.length > 0 || v.plan.notes.length > 0
                ? "Nothing can be switched right now."
                : "Your funds already match your list, or the list is empty."}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2 text-sm">
                {v.plan.switches.map((s) => (
                  <li key={`${s.accountId}-${s.from.ticker}`}>
                    <strong>{s.accountName}:</strong> {s.from.name} (
                    {formatCents(s.from.valueCents)}) into{" "}
                    {s.legs.map((l) => `${l.name} (${formatCents(l.amountCents)})`).join(" and ")}.
                    Fees {signed(s.feeDeltaCents)} a year
                    {s.gainCents !== null && s.taxable
                      ? `; selling realises about ${formatCents(Math.abs(s.gainCents))} ${s.gainCents >= 0 ? "of gain" : "of loss"}`
                      : ""}
                    .
                  </li>
                ))}
              </ul>
              <p className="text-sm">
                Cost: fees change by {signed(v.plan.feeDeltaCents)} a year in all.{" "}
                {v.plan.gainCents > 0
                  ? `Selling in taxable accounts realises about ${formatCents(v.plan.gainCents)} of gains, which may be taxed.`
                  : ""}
              </p>
              <ul className="list-disc pl-5 text-sm">
                {v.plan.diversification.map((d) => (
                  <li key={d.assetClass}>
                    {d.assetClass.replace("_", " ")}: about{" "}
                    {d.beforeHoldings.toLocaleString("en-US")} holdings become about{" "}
                    {d.afterHoldings.toLocaleString("en-US")} (keeping {Math.round(d.keptBps / 100)}
                    % of the market&apos;s value).
                  </li>
                ))}
              </ul>
              <p className="text-sm">
                Your stocks-and-bonds mix is unchanged by this: each switch stays inside the same
                kind of investment.
              </p>
              <form action={switchFunds} className="flex flex-col gap-2">
                <input type="hidden" name="key" value={v.plan.key} />
                <SimulatedBanner />
                <SubmitButton className={`${BUTTON} self-start`}>Switch these funds</SubmitButton>
                <DemoAdviceLabel />
              </form>
            </>
          )}
          {v.plan.notes.map((n) => (
            <p key={n} className="text-sm text-zinc-600 dark:text-zinc-400">
              {n}
            </p>
          ))}
          {v.plan.skipped.map((s) => (
            <p key={`${s.accountName}-${s.name}`} className="text-xs text-zinc-500">
              {s.name} in {s.accountName}: {s.reason}.
            </p>
          ))}
        </section>
      )}
      <p className="text-xs text-zinc-500">
        Your list also steers what the rebalance and automatic investing buy. {v.source}.
      </p>
    </>
  );
}

export default function ValuesPage(props: PageProps<"/investments/values">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
