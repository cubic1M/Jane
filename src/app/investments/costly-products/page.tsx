import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { LOW_COST_SOURCE } from "@/config/costly-products";
import { loadCostlyProducts, type ProductView } from "@/lib/investments/costly-products";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { answer, demoProducts } from "./actions";
import { ProductForm } from "./product-form";
import { SubmitButton } from "@/components/submit-button";

// What costly products really cost (spec step 215, demo advice): annuities, whole life and
// advisory fees in dollars, with the surrender charge by year, what the same money would do
// in low-cost funds as a range, and when leaving costs less than staying. Nothing here
// leaves or cancels anything, and nothing is recommended on real accounts.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-lg border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Product({ p, advice }: { p: ProductView; advice: boolean }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-xl font-semibold">
        {p.name} <span className="text-sm font-normal text-zinc-500">({p.provider})</span>
      </h2>
      <p className="text-sm">
        {p.kind === "annuity"
          ? `Worth ${formatCents(p.valueCents)}; it costs about ${formatCents(p.yearlyCostCents ?? 0)} a year (${(p.feeBps ?? 0) / 100}%).`
          : `Cash value ${formatCents(p.valueCents)}; you pay ${formatCents(p.premiumYearlyCents)} a year in premiums.`}
      </p>
      {p.surrender && (
        <div className="text-sm">
          <p>
            If you left now, the surrender charge would be {p.surrender.pctNow}% (
            {formatCents(p.surrender.cents)}). It reaches zero on {day(p.surrender.endsOn)}.
          </p>
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="font-normal">Contract year</th>
                <th className="text-right font-normal">Charge</th>
                <th className="text-right font-normal">In dollars</th>
              </tr>
            </thead>
            <tbody>
              {p.surrender.byYear.map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td>
                  <td className="text-right">{r.pct}%</td>
                  <td className="text-right">{formatCents(r.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {advice && p.gap && (
        <p className="text-sm">
          The same money in a low-cost fund (about 0.04% a year) could be worth{" "}
          {formatCents(p.gap.lowCents)} to {formatCents(p.gap.highCents)} more after {p.gap.years}{" "}
          years. That is the cost difference, not a forecast. ({LOW_COST_SOURCE}.)
        </p>
      )}
      {advice && p.exit && (
        <p className="text-sm">
          Over the next {p.exit.horizonYears} years, staying costs about{" "}
          {formatCents(p.exit.stayCents)} in fees. Leaving now costs{" "}
          {formatCents(p.exit.leaveNowCents)} (the {formatCents(p.exit.surrenderNowCents)} surrender
          charge plus fees after).{" "}
          {p.exit.verdict === "wait"
            ? `Waiting ${p.exit.bestWaitYears} years, until the charge is smaller, would cost about ${formatCents(p.exit.bestCents)}.`
            : p.exit.verdict === "leave_now"
              ? "Leaving now comes out cheapest, charge included."
              : "Staying is fine on cost."}
        </p>
      )}
      {advice && p.wholeLife && (
        <p className="text-sm">
          You&apos;ve paid in about {formatCents(p.wholeLife.paidCents)}; leaving now would return{" "}
          {formatCents(p.wholeLife.leaveNowCents)} after a {formatCents(p.wholeLife.surrenderCents)}{" "}
          surrender charge. The same premiums in a low-cost fund could be worth{" "}
          {formatCents(p.wholeLife.inFundsCents.lowCents)} to{" "}
          {formatCents(p.wholeLife.inFundsCents.highCents)}.
        </p>
      )}
      {p.note && <p className="text-xs text-zinc-500">{p.note}</p>}
      {advice && <DemoAdviceLabel />}
    </section>
  );
}

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/costly-products">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadCostlyProducts(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">What costly products really cost</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Variable annuities, whole life insurance and advisory fees, in dollars a year, with the
          charge for leaving and when it ends. Jane never says to leave one without those figures.
        </p>
      </div>
      {(done === "saved" || done === "linked") && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "saved" ? "Saved." : "Demo products added."}
        </p>
      )}
      {v.asked.map((a) => (
        <form
          key={a.id}
          action={answer}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <input type="hidden" name="id" value={a.id} />
          <span className="text-sm">
            You paid {a.provider} about {formatCents(a.yearlyCents)} in the last year. Is that a
            whole life policy?
          </span>
          <SubmitButton name="yes" value="yes" className={BUTTON}>
            Yes
          </SubmitButton>
          <SubmitButton name="yes" value="no" className={SECONDARY}>
            No
          </SubmitButton>
        </form>
      ))}
      {v.advisory && (
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-xl font-semibold">Advisory fees</h2>
          <p className="text-sm">
            You paid {formatCents(v.advisory.yearlyCents)} in advisory fees in the last 12 months on
            about {formatCents(v.advisory.assetsCents)}: {v.advisory.feeBps / 100}% a year, besides
            the funds&apos; own costs. A low-cost fund alone would cost about{" "}
            {formatCents(v.advisory.lowCostYearlyCents)}.
          </p>
          {v.advice && (
            <p className="text-sm">
              Over {v.advisory.gap.years} years that cost difference could be{" "}
              {formatCents(v.advisory.gap.lowCents)} to {formatCents(v.advisory.gap.highCents)}. It
              is a gap in cost, not a forecast. Whether the advice is worth it is yours to judge;
              leaving an adviser has no surrender charge, but check your agreement.
            </p>
          )}
        </section>
      )}
      {v.products.map((p) => (
        <Product key={p.id} p={p} advice={v.advice} />
      ))}
      {v.products.length === 0 && !v.advisory && v.asked.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          None found yet. Add one below{v.demo ? ", or try demo products" : ""}.
        </p>
      )}
      {v.demo && v.products.length === 0 && (
        <form action={demoProducts}>
          <SubmitButton className={BUTTON}>Add demo products</SubmitButton>
        </form>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Add one from a statement</h2>
        <ProductForm />
      </section>
    </>
  );
}

export default function CostlyProductsPage(props: PageProps<"/investments/costly-products">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
