import Link from "next/link";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { SideIncomeView } from "@/lib/side-income";
import { roundDollars } from "@/planning/tax-estimate-copy";

// Side income and rentals on /taxes (spec step 173): a rental's rent, tagged expenses and
// depreciation; each gig platform's payouts matched to its 1099; hobby or business.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "text-emerald-700 underline";
const STATUS = {
  matched: "Matches its 1099",
  differs: "Doesn't match its 1099 (not used)",
  waiting: "Waiting for its 1099",
  unneeded: "Under the amount that gets a 1099",
} as const;

export function SideIncomeSection({ view, advice }: { view: SideIncomeView; advice: boolean }) {
  if (!view.rental && view.platforms.length === 0) return null;
  const r = view.rental;
  return (
    <section aria-labelledby="side-income-heading" id="side-income" className={CARD}>
      <h2 id="side-income-heading" className="text-xl font-semibold">
        Side income and rentals
      </h2>
      {r && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">Rental</h3>
          <table className="w-full">
            <caption className="sr-only">Your rental for {view.year}</caption>
            <tbody>
              <tr>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  Rent in ({r.rentRows.length} {r.rentRows.length === 1 ? "payment" : "payments"})
                </th>
                <td className="text-right">{formatCents(r.rentCents)}</td>
              </tr>
              <tr>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  Expenses you tagged ({r.expenseRows.length})
                </th>
                <td className="text-right">−{formatCents(r.expensesCents)}</td>
              </tr>
              <tr>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  Depreciation
                  {r.depreciation
                    ? ` (${(r.depreciation.percent * 100).toFixed(3)}% of ${formatCents(r.depreciation.buildingCents)} of building)`
                    : ""}
                </th>
                <td className="text-right">−{formatCents(r.depreciationCents)}</td>
              </tr>
              <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-800">
                <th scope="row" className="py-1 pr-2 text-left">
                  {r.netCents < 0 ? "Loss" : "Profit"}
                </th>
                <td className="text-right">{formatCents(Math.abs(r.netCents))}</td>
              </tr>
            </tbody>
          </table>
          {r.suspendedCents > 0 && (
            <p className="text-zinc-600 dark:text-zinc-400">
              Only {formatCents(-r.countedCents)} of the loss counts this year;{" "}
              {formatCents(r.suspendedCents)} carries forward.
            </p>
          )}
          {r.rentRows.slice(0, 5).map((p) => (
            <Link
              key={p.id}
              href={`/transactions?q=${encodeURIComponent(p.payer)}`}
              className={LINK}
            >
              {p.payer}, {dayLabel(p.date, { year: true })}, {formatCents(p.cents)}
            </Link>
          ))}
          <Link href="/taxes/profile#side-income" className={LINK}>
            {r.priceCents ? "Change the property" : "Add the property for depreciation"}
          </Link>
        </div>
      )}
      {view.platforms.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">Gig and freelance payouts</h3>
          <ul className="flex flex-col gap-1">
            {view.platforms.map((p) => (
              <li key={p.payer} className="flex flex-wrap justify-between gap-x-3">
                <Link href={`/transactions?q=${encodeURIComponent(p.payer)}`} className={LINK}>
                  {p.payer}: {formatCents(p.payoutsCents)}
                </Link>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {STATUS[p.status]}
                  {p.formCents !== null ? ` (${formatCents(p.formCents)})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {advice && view.bothWays && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">Hobby or business?</h3>
          <p>
            Federal tax about {roundDollars(view.bothWays.business)} as a business, about{" "}
            {roundDollars(view.bothWays.hobby)} as a hobby.{" "}
            {view.kind
              ? `You treat it as a ${view.kind}.`
              : "Which it is depends on how you run it: tell Jane on your tax profile."}
          </p>
          <DemoAdviceLabel />
        </div>
      )}
    </section>
  );
}
