import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import {
  COMPANY_DROP,
  EMPLOYER_STOCK_LIMIT,
  EMPLOYER_STOCK_SOURCE,
  GRANT_KINDS,
} from "@/config/company-stock";
import { loadCompanyStock } from "@/lib/investments/company-stock";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { linkStockPlan, sellNow } from "./actions";
import { GrantForm } from "./grant-form";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Company stock (spec step 160, demo advice): how much of what's invested is in the
// employer's stock, what's still to vest, and a plan to sell down in parts with the tax
// cost and the risk it removes. Each part is a tap.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const DONE: Record<string, string> = {
  saved: "Grant saved.",
  linked: "Demo stock plan linked.",
  sold: "Sold the first part and bought broad index funds with it.",
};
const pct = (n: number) => `${Math.round(n * 100)}%`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function CompanyContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/company-stock">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const view = await loadCompanyStock(user.id);
  const c = view.concentration;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Company stock</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Stock from where you work: if the company has a bad year, your job and your savings are
          hit at once. A common rule is to keep it under {pct(EMPLOYER_STOCK_LIMIT)} of what
          you&apos;ve invested ({EMPLOYER_STOCK_SOURCE}).
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
      {(done === "sold" || (view.advice && (view.plan?.parts.length ?? 0) > 0)) && (
        <SimulatedBanner />
      )}

      {view.company ? (
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-xl font-semibold">{view.company}</h2>
          <p className="text-sm">
            {formatCents(c.heldCents)} held: {pct(c.share)} of what you&apos;ve invested
            {c.unvestedCents > 0
              ? `, and ${formatCents(c.unvestedCents)} more still to vest (${pct(c.shareWithUnvested)} with it)`
              : ""}
            .
          </p>
          <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            {view.holdings.map((h) => (
              <li key={h.id}>
                {h.accountName}: {h.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
                shares, {formatCents(h.valueCents)}
              </li>
            ))}
            {view.grants.map((g) => (
              <li key={g.id}>
                {GRANT_KINDS[g.kind]}: {g.unvestedShares} shares still to vest
                {g.sharesPerVest && g.everyMonths
                  ? `, ${g.sharesPerVest} every ${g.everyMonths} months`
                  : ""}
                {g.nextVestOn ? `, next on ${day(g.nextVestOn)}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane doesn&apos;t see stock from where you work. Add a grant below
          {view.demo ? ", or try a demo stock plan" : ""}.
        </p>
      )}

      {view.demo && !view.holdings.some((h) => h.accountName === "Demo Stock Plan") && (
        <form action={linkStockPlan}>
          <SubmitButton className={BUTTON}>Link a demo stock plan</SubmitButton>
        </form>
      )}

      {view.advice && view.plan && view.plan.parts.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <h2 className="text-xl font-semibold">Sell down in {view.plan.parts.length} parts</h2>
          <p className="text-sm">
            Selling about {formatCents(view.plan.sellCents)} from your {view.plan.accountName}{" "}
            brings {view.company} from {pct(view.plan.shareBefore)} to {pct(view.plan.shareAfter)}{" "}
            of what you&apos;ve invested. A {pct(COMPANY_DROP)} drop in it would cost about{" "}
            {formatCents(view.plan.dropAfterCents)} instead of{" "}
            {formatCents(view.plan.dropBeforeCents)}. Estimated tax on the gains: about{" "}
            {formatCents(view.plan.taxCents)}, spread over the parts.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="font-normal">When</th>
                <th className="text-right font-normal">Sell</th>
                <th className="text-right font-normal">Gain</th>
                <th className="text-right font-normal">Tax (est.)</th>
              </tr>
            </thead>
            <tbody>
              {view.plan.parts.map((p) => (
                <tr key={p.index}>
                  <td>{p.index === 0 ? "Now" : day(p.on)}</td>
                  <td className="text-right">{formatCents(p.proceedsCents)}</td>
                  <td className="text-right">{formatCents(p.gainCents)}</td>
                  <td className="text-right">{formatCents(p.taxCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.plan.parts[0].on <= new Date().toISOString().slice(0, 10) && (
            <form action={sellNow}>
              <input type="hidden" name="key" value={view.plan.key} />
              <SubmitButton className={BUTTON}>Sell the first part (simulated)</SubmitButton>
            </form>
          )}
          <p className="text-xs text-zinc-500">
            The oldest shares are sold first: held over a year, their gains are taxed less.{" "}
            {view.rates.fromEstimate
              ? "Rates from your tax estimate."
              : "Rates assume a single filer in the middle bracket; fill in your tax profile for yours."}
          </p>
          <DemoAdviceLabel />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Add a grant</h2>
        <GrantForm company={view.company} />
      </section>
    </>
  );
}

export default function CompanyStockPage(props: PageProps<"/investments/company-stock">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <CompanyContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
