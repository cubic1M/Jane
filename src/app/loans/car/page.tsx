import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { CAR_COST_SOURCE, CAR_TERMS_MONTHS } from "@/config/car";
import { loadCar } from "@/lib/car";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { formatRate } from "@/lib/percent";

// Buying a car (spec step 178): what the person can afford with insurance and running
// costs in, preapproval offers compared by what they cost in all, and a dealer's financing
// checked against the best. A plain GET form; nothing is stored or applied for. Demo
// advice, every assumption shown.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const dollars = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
};

async function CarContent({ searchParams }: Pick<PageProps<"/loans/car">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const term = Number(p("term"));
  const apr = Number(p("dealerApr"));
  const dealerMonths = Number(p("dealerMonths"));
  const car = await loadCar(user.id, {
    priceCents: dollars(p("price")),
    downCents: dollars(p("down")),
    termMonths: (CAR_TERMS_MONTHS as readonly number[]).includes(term) ? term : undefined,
    dealer:
      apr > 0 && dealerMonths > 0
        ? {
            aprBps: Math.round(apr * 100),
            termMonths: dealerMonths,
            feesCents: dollars(p("dealerFees")) ?? 0,
          }
        : undefined,
  });
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Buying a car</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Sort the loan before you walk into a dealership: what you can afford, with insurance and
          running costs in, and what each lender would charge.
        </p>
      </div>
      {!car.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Car loan offers come from a lending partner, and there isn&apos;t one for your accounts
          yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : car.missing === "income" || !car.costs ? (
        <p>I need a few months of income to see before I can say what car fits.</p>
      ) : (
        <>
          <DemoAdviceLabel />
          <section aria-labelledby="afford" className="flex flex-col gap-2">
            <h2 id="afford" className="text-xl font-semibold">
              What you can afford
            </h2>
            <p>
              Up to about <strong>{formatCents(car.maxPriceCents!)}</strong>, keeping everything
              under {formatCents(car.allowanceCents!)} a month.
            </p>
            <table aria-label="Monthly cost" className="w-full text-left text-sm">
              <caption className="text-left font-medium">
                A {formatCents(car.costs.priceCents)} car, a month
              </caption>
              <tbody>
                {(
                  [
                    ["Loan payment", car.costs.paymentCents],
                    ["Insurance", car.costs.insuranceCents],
                    ["Fuel", car.costs.fuelCents],
                    ["Upkeep", car.costs.maintenanceCents],
                    ["Registration", car.costs.registrationCents],
                    ["All in", car.costs.allInCents],
                  ] as const
                ).map(([label, cents]) => (
                  <tr key={label} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1">{label}</td>
                    <td className="py-1">{formatCents(cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p
              className={
                car.withinBudget
                  ? "text-emerald-800 dark:text-emerald-200"
                  : "text-amber-800 dark:text-amber-300"
              }
            >
              {car.withinBudget ? "Within" : "Over"} the {formatCents(car.allowanceCents!)} a month
              I&apos;d stay under.
            </p>
          </section>
          <section aria-labelledby="offers" className="flex flex-col gap-2">
            <h2 id="offers" className="text-xl font-semibold">
              Preapproval offers
            </h2>
            {car.offers.length === 0 && (
              <p role="status" className="text-amber-800 dark:text-amber-300">
                No lender I check lends {formatCents(car.costs.financedCents)} for a car
                {car.lenderLimitCents !== null
                  ? `; the most one would quote is about ${formatCents(car.lenderLimitCents)}`
                  : ""}
                . A lower price or a bigger down payment brings offers.
              </p>
            )}
            <ul aria-label="Offers" className="flex flex-col gap-2 text-sm">
              {car.offers.map((o, i) => (
                <li
                  key={o.offer.id}
                  className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <p className="font-medium">
                    {o.offer.lender} at {formatRate(o.offer.aprBps)}
                    {i === 0 ? " (cheapest)" : ""}
                  </p>
                  <p>
                    {formatCents(o.monthlyCents)} a month, {formatCents(o.totalCents)} in all over{" "}
                    {car.termMonths} months. {o.offer.feeLabel}.
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {car.dealer && (
            <section aria-labelledby="dealer" className="flex flex-col gap-1">
              <h2 id="dealer" className="text-xl font-semibold">
                The dealer&apos;s financing
              </h2>
              <p role="status">
                {car.dealer.verdict === "better"
                  ? `Costs ${formatCents(-car.dealer.extraCents)} less than the best preapproval.`
                  : `Costs ${formatCents(car.dealer.extraCents)} more than the best preapproval${car.dealer.verdict === "worse" ? `, at a rate ${(car.dealer.extraBps / 100).toFixed(2)} points higher` : ""}.`}{" "}
                {formatCents(car.dealer.monthlyCents)} a month, {formatCents(car.dealer.totalCents)}{" "}
                in all.
              </p>
            </section>
          )}
          <form method="get" className="grid gap-3 sm:grid-cols-2" aria-label="Try a car">
            <label className="flex flex-col gap-1 text-sm">
              Price
              <input
                name="price"
                inputMode="decimal"
                placeholder={`${car.maxPriceCents! / 100}`}
                defaultValue={p("price")}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Down payment
              <input name="down" inputMode="decimal" defaultValue={p("down")} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Loan months
              <select name="term" defaultValue={String(car.termMonths)} className={INPUT}>
                {CAR_TERMS_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
              <legend className="text-sm font-medium">The dealer&apos;s offer (optional)</legend>
              <label className="flex flex-col gap-1 text-sm">
                APR %
                <input
                  name="dealerApr"
                  inputMode="decimal"
                  defaultValue={p("dealerApr")}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Months
                <input
                  name="dealerMonths"
                  inputMode="numeric"
                  defaultValue={p("dealerMonths")}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Fees
                <input
                  name="dealerFees"
                  inputMode="decimal"
                  defaultValue={p("dealerFees")}
                  className={INPUT}
                />
              </label>
            </fieldset>
            <button
              type="submit"
              className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 sm:col-span-2 sm:w-fit"
            >
              Check this car
            </button>
          </form>
          <section aria-labelledby="assumptions" className="flex flex-col gap-1 text-sm">
            <h2 id="assumptions" className="text-xl font-semibold">
              Assumptions
            </h2>
            <ul className="list-disc pl-5">
              {car.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <a href={CAR_COST_SOURCE} className={LINK}>
              Auto loans (CFPB)
            </a>
          </section>
        </>
      )}
    </>
  );
}

export default function CarPage({ searchParams }: PageProps<"/loans/car">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <CarContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
