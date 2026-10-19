import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { InvestmentTaxesView } from "@/lib/investment-taxes";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { harvestSaving } from "@/lib/jane-agent/tax-investments";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";

// Investment taxes on /taxes (spec step 124): gains and losses from the cost basis the
// broker reports, wash sales, and (demo advice) losses worth harvesting and where to hold
// what.

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function InvestmentsSection({
  view,
  estimate,
  advice,
}: {
  view: InvestmentTaxesView;
  estimate: TaxEstimateView;
  advice: boolean;
}) {
  if (view.taxableAccounts === 0) return null;
  const r = view.realisedCents;
  return (
    <section
      aria-labelledby="investments-heading"
      id="investments"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="investments-heading" className="text-xl font-semibold">
        Investments
      </h2>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-600 dark:text-zinc-400">Realised in {view.year}, long-term</dt>
          <dd>{formatCents(r.longTerm)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-600 dark:text-zinc-400">Realised in {view.year}, short-term</dt>
          <dd>{formatCents(r.shortTerm)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-600 dark:text-zinc-400">Not yet sold</dt>
          <dd>{formatCents(view.unrealisedCents.total)}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500">
        From the cost basis your broker reports, at each holding&apos;s average cost.
      </p>
      {view.washSales.map((w) => (
        <p key={`${w.securityId}${w.date}`} className="text-sm text-amber-800 dark:text-amber-300">
          Wash sale: {w.ticker ?? w.name} sold at a loss on {day(w.date)} and bought again within 30
          days, so {formatCents(w.washDisallowedCents)} of the loss doesn&apos;t count this year.
        </p>
      ))}
      {advice && (view.harvest.length > 0 || view.location.length > 0) && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
          {view.harvest.map((h) => (
            <p key={h.holding.securityId}>
              {h.holding.name} is down {formatCents(h.lossCents)}: selling it before Dec 31 would
              mean about {roundDollars(harvestSaving(h, estimate))} less tax, by my estimate
              {h.washRisk.reinvests ? " (turn off dividend reinvestment first)" : ""}.
            </p>
          ))}
          {view.location.map((h) => (
            <p key={`loc${h.securityId}`}>
              {h.name}: its payouts are taxed every year here; it&apos;s better held in a 401(k) or
              IRA.
            </p>
          ))}
          <DemoAdviceLabel />
        </div>
      )}
    </section>
  );
}
