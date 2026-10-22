import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { HOME_RULES_SOURCE } from "@/config/home-buying";
import { formatRate } from "@/insights/loans";
import { dayLabel } from "@/lib/day-label";
import { loadHomeBuying } from "@/lib/home-buying";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { startGoalAction } from "./actions";

// Buying a home (spec step 179): from saving to closing. What the person can afford under
// the usual 28/36 rules, the monthly cost with mortgage insurance explained, the cash needed
// up front, a plan to save it, mortgage offers compared, and the down payment goal started
// with one tap. A plain GET form; every assumption is shown. Demo advice.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const dollars = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
};

async function HomeContent({ searchParams }: Pick<PageProps<"/loans/home">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const down = Number(p("down"));
  const date = p("date");
  const home = await loadHomeBuying(user.id, {
    priceCents: dollars(p("price")),
    downShare: down > 0 && down < 100 ? down / 100 : undefined,
    targetDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
  });
  const ready = home.available && home.costs && home.affordability && home.saving;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Buying a home</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          From saving to closing: what you can afford, what you need up front, and how long it takes
          you to save it.
        </p>
      </div>
      {!ready ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          {home.missing === "income"
            ? "I need a few months of income to see before I can say what home fits."
            : "I can't work out what home fits yet."}{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          {home.advice ? <DemoAdviceLabel /> : null}
          {p("started") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Started just now. It&apos;s on your goals page.
            </p>
          )}
          {p("error") && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {p("error")}
            </p>
          )}
          <section aria-labelledby="afford" className="flex flex-col gap-2">
            <h2 id="afford" className="text-xl font-semibold">
              What you can afford
            </h2>
            <p>
              Up to about <strong>{formatCents(home.affordability!.maxPriceCents)}</strong>, with
              housing under {formatCents(home.affordability!.allowedHousingCents)} a month.
            </p>
            <table aria-label="Monthly cost" className="w-full text-left text-sm">
              <caption className="text-left font-medium">
                A {formatCents(home.costs!.priceCents)} home, a month
              </caption>
              <tbody>
                {(
                  [
                    ["Loan (principal and interest)", home.costs!.principalAndInterestCents],
                    ["Property tax", home.costs!.propertyTaxCents],
                    ["Home insurance", home.costs!.insuranceCents],
                    ...(home.costs!.pmiCents
                      ? [["Mortgage insurance (PMI)", home.costs!.pmiCents] as const]
                      : []),
                    ["Total", home.costs!.housingCents],
                  ] as const
                ).map(([label, cents]) => (
                  <tr key={label} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1">{label}</td>
                    <td className="py-1">{formatCents(cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {home.costs!.pmiCents > 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                PMI protects the lender while you put down under 20%. It comes off once you owe 80%
                of the home&apos;s value or less; Jane watches for that on your mortgage page.
              </p>
            )}
          </section>
          <section aria-labelledby="saving" className="flex flex-col gap-2">
            <h2 id="saving" className="text-xl font-semibold">
              Saving for it
            </h2>
            <p>
              You&apos;ll need <strong>{formatCents(home.costs!.cashNeededCents)}</strong> up front:{" "}
              {formatCents(home.costs!.downCents)} down and about{" "}
              {formatCents(home.costs!.closingCents)} in closing costs.
            </p>
            <p role="status">
              {home.saving!.stillNeededCents === 0
                ? "You have that saved already."
                : home.saving!.onTrack
                  ? `You have ${formatCents(home.savedCents)} and keep about ${formatCents(home.monthlySavingCents)} a month: on track for ${dayLabel(home.targetDate, { year: true })}.`
                  : `You have ${formatCents(home.savedCents)}. To have it by ${dayLabel(home.targetDate, { year: true })}, save ${formatCents(home.saving!.monthlyNeededCents)} a month; at the ${formatCents(home.monthlySavingCents)} you keep now, ${home.saving!.monthsAtCurrentPace ? `it takes ${home.saving!.monthsAtCurrentPace} months` : "you're not saving each month"}.`}
            </p>
            {!home.hasGoal && home.saving!.stillNeededCents > 0 && (
              <form action={startGoalAction}>
                <input type="hidden" name="price" value={home.costs!.priceCents} />
                <input type="hidden" name="downShare" value={home.downShare} />
                <input type="hidden" name="targetDate" value={home.targetDate} />
                <button
                  type="submit"
                  className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800"
                >
                  Start a {formatCents(home.costs!.cashNeededCents)} goal
                </button>
                <span className="ml-3 text-xs text-zinc-600 dark:text-zinc-400">
                  It goes on your goals page, and Jane invests it for its timeline.
                </span>
              </form>
            )}
            {home.hasGoal && (
              <p className="text-sm">
                Your down payment goal is on{" "}
                <Link href="/goals" className={LINK}>
                  your goals page
                </Link>
                .
              </p>
            )}
          </section>
          {home.offers.length > 0 ? (
            <section aria-labelledby="offers" className="flex flex-col gap-2">
              <h2 id="offers" className="text-xl font-semibold">
                Mortgage offers
              </h2>
              <ul aria-label="Offers" className="flex flex-col gap-2 text-sm">
                {home.offers.map((o, i) => (
                  <li
                    key={o.offer.id}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <p className="font-medium">
                      {o.offer.lender} at {formatRate(o.offer.aprBps)}
                      {i === 0 ? " (cheapest)" : ""}
                    </p>
                    <p>
                      {formatCents(o.monthlyCents)} a month for the loan,{" "}
                      {formatCents(o.totalCents)} in all over 30 years. {o.offer.feeLabel}.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <form method="get" className="grid gap-3 sm:grid-cols-3" aria-label="Try a home">
            <label className="flex flex-col gap-1 text-sm">
              Price
              <input
                name="price"
                inputMode="decimal"
                defaultValue={p("price")}
                placeholder={`${home.affordability!.maxPriceCents / 100}`}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Down payment %
              <input
                name="down"
                inputMode="decimal"
                defaultValue={p("down") ?? String(home.downShare * 100)}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Have it by
              <input name="date" type="date" defaultValue={home.targetDate} className={INPUT} />
            </label>
            <button
              type="submit"
              className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 sm:col-span-3 sm:w-fit"
            >
              Check this home
            </button>
          </form>
          <section aria-labelledby="assumptions" className="flex flex-col gap-1 text-sm">
            <h2 id="assumptions" className="text-xl font-semibold">
              Assumptions
            </h2>
            <ul className="list-disc pl-5">
              {home.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <a href={HOME_RULES_SOURCE} className={LINK}>
              Owning a home (CFPB)
            </a>
          </section>
        </>
      )}
    </>
  );
}

export default function HomePage({ searchParams }: PageProps<"/loans/home">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <HomeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
