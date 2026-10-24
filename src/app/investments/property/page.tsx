import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PAYDOWN_NOTE } from "@/config/property";
import { loadProperty } from "@/lib/investments/property";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { demoRental } from "./actions";
import { RentalForm } from "./rental-form";
import { SubmitButton } from "@/components/submit-button";

// Property as an investment (spec step 214, demo advice): home equity, each rental's
// figures from its own transactions, depreciation for the taxes side, and paying the
// mortgage down against investing. Both sides always shown.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 1000) / 10}%`);

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/property">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadProperty(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Property</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your home&apos;s equity, each rental&apos;s real numbers from its own transactions, and
          whether paying the mortgage down beats investing.
        </p>
      </div>
      {(done === "saved" || done === "linked") && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "saved" ? "Rental added." : "Demo rental added."}
        </p>
      )}

      {v.homes.map((h) => (
        <section
          key={h.id}
          className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">{h.name}</h2>
          <p className="text-sm">
            Worth {formatCents(h.valueCents)} (your value, as of {h.valuedOn})
            {h.loanCents !== null ? `, owing ${formatCents(h.loanCents)}: ` : ": "}
            equity of {formatCents(h.equityCents)}. It counts in your net worth.
          </p>
        </section>
      ))}

      {v.advice && v.paydown && (
        <section className="flex flex-col gap-2 rounded-xl border border-emerald-300 p-4 dark:border-emerald-800">
          <h2 className="text-xl font-semibold">Pay the mortgage down, or invest?</h2>
          <p className="text-sm">
            An extra {formatCents(v.paydown.extraMonthlyCents)} a month for {v.paydown.years} years
            on {v.paydown.homeName} (at {pct(v.paydown.rateBps / 10_000)}):
          </p>
          <ul className="list-disc pl-5 text-sm">
            <li>
              Paying down saves about {formatCents(v.paydown.paydown.interestSavedCents)} in
              interest, for certain.
            </li>
            <li>
              Investing it could grow by about {formatCents(v.paydown.invest.lowGainCents)} to{" "}
              {formatCents(v.paydown.invest.highGainCents)}, with no guarantee.
            </li>
          </ul>
          <p className="text-sm">
            {v.paydown.verdict === "paydown"
              ? "The mortgage rate is above the top of the assumed investing range, so paying it down looks better."
              : v.paydown.verdict === "invest"
                ? "The mortgage rate is below the bottom of the assumed investing range, so investing looks better."
                : "The mortgage rate sits inside the investing range: it comes down to how much risk you want. A split is reasonable."}
          </p>
          <p className="text-xs text-zinc-500">{PAYDOWN_NOTE}</p>
          <DemoAdviceLabel />
        </section>
      )}

      {v.rentals.map((r) => (
        <section
          key={r.id}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">{r.name}</h2>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td>Rent in ({r.counts.rent} deposits)</td>
                <td className="text-right">{formatCents(r.figures.rentCents)}</td>
              </tr>
              <tr>
                <td>Mortgage paid ({r.counts.mortgage} payments)</td>
                <td className="text-right">{formatCents(r.figures.mortgagePaidCents)}</td>
              </tr>
              <tr>
                <td>Property tax ({r.counts.tax})</td>
                <td className="text-right">{formatCents(r.figures.propertyTaxCents)}</td>
              </tr>
              <tr>
                <td>Repairs and insurance ({r.counts.other})</td>
                <td className="text-right">{formatCents(r.figures.otherExpensesCents)}</td>
              </tr>
              <tr className="font-medium">
                <td>Cash flow (what hit your bank)</td>
                <td className="text-right">{formatCents(r.figures.cashFlowCents)}</td>
              </tr>
              <tr>
                <td>Profit (rent less costs and mortgage interest)</td>
                <td className="text-right">{formatCents(r.figures.profitCents)}</td>
              </tr>
              <tr>
                <td>Depreciation for {r.depreciationYear}</td>
                <td className="text-right">{formatCents(r.figures.depreciationCents)}</td>
              </tr>
              <tr>
                <td>Taxable profit (handed to your taxes)</td>
                <td className="text-right">{formatCents(r.figures.taxableCents)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-sm">
            On {formatCents(r.cashInvestedCents)} you put in: {pct(r.figures.cashOnCash)} a year in
            cash flow, {pct(r.figures.returnWithPrincipal)} counting the principal you paid down.
          </p>
          <p className="text-xs text-zinc-500">
            The last 12 months of your own transactions. Depreciation is figured with your taxes
            (IRS Publication 527, 27.5 years).
          </p>
        </section>
      ))}

      {v.rentals.length === 0 && v.demo && (
        <form action={demoRental}>
          <SubmitButton className={BUTTON}>Add a demo rental</SubmitButton>
        </form>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Add a rental</h2>
        <RentalForm />
      </section>
    </>
  );
}

export default function PropertyPage(props: PageProps<"/investments/property">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
