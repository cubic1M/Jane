import { formatCents } from "@/lib/money";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { FILING_STATUSES } from "@/config/tax";
import { ESTIMATE_NOTE, federalLine, stateLine, stateSource } from "@/planning/tax-estimate-copy";
import { dayLabel } from "@/lib/day-label";
import { STATE_SOURCES } from "@/config/tax-states";
import { stateName } from "@/planning/tax-profile";

// The tax estimate on /taxes (spec step 120): the refund or bill, federal and state, the
// working behind it, and everything Jane assumed. Every figure is an estimate.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <tr className="border-t border-zinc-200 dark:border-zinc-800">
      <th scope="row" className={`py-1 pr-2 text-left ${strong ? "font-semibold" : "font-normal"}`}>
        {label}
      </th>
      <td className={`py-1 text-right whitespace-nowrap ${strong ? "font-semibold" : ""}`}>
        {cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents)}
      </td>
    </tr>
  );
}

export function EstimateSection({ view }: { view: TaxEstimateView }) {
  const e = view.estimate;
  const state = stateLine(e.state, view.withholdingKnown);
  const credits =
    e.credits.childTaxCreditCents +
    e.credits.otherDependantCreditCents +
    e.credits.additionalChildTaxCreditCents +
    e.credits.earnedIncomeCreditCents;
  const otherTaxes =
    e.selfEmploymentTaxCents + e.additionalMedicareCents + e.netInvestmentIncomeTaxCents;
  return (
    <section aria-labelledby="estimate-heading" id="estimate" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="estimate-heading" className="text-xl font-semibold">
          Your {view.year} estimate
        </h2>
        <span className="border border-zinc-400 px-2 py-0.5 text-xs font-medium dark:border-zinc-600">
          Estimate
        </span>
      </div>
      <p className="text-lg">{federalLine(e, view.withholdingKnown)}</p>
      {state && <p className="text-lg">{state}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium underline underline-offset-2">
          How Jane worked it out
        </summary>
        <table className="mt-2 w-full">
          <caption className="sr-only">The federal estimate, line by line</caption>
          <tbody>
            <Row label={`Income for ${view.year}, projected`} cents={e.totalIncomeCents} />
            {e.adjustments.halfSelfEmploymentTaxCents > 0 && (
              <Row
                label="Half of self-employment tax"
                cents={-e.adjustments.halfSelfEmploymentTaxCents}
              />
            )}
            {e.adjustments.studentLoanInterestCents > 0 && (
              <Row label="Student loan interest" cents={-e.adjustments.studentLoanInterestCents} />
            )}
            <Row label="Adjusted gross income" cents={e.agiCents} strong />
            <Row
              label={e.deduction.kind === "itemized" ? "Itemized deductions" : "Standard deduction"}
              cents={
                -(e.deduction.kind === "itemized"
                  ? e.deduction.itemizedCents
                  : e.deduction.standardCents)
              }
            />
            {e.deduction.nonItemizerCharityCents > 0 && (
              <Row label="Cash gifts to charity" cents={-e.deduction.nonItemizerCharityCents} />
            )}
            {e.qbiCents > 0 && (
              <Row label="Qualified business income deduction" cents={-e.qbiCents} />
            )}
            <Row label="Taxable income" cents={e.taxableCents} strong />
            <Row
              label={`Income tax (${FILING_STATUSES[e.filingStatus].toLowerCase()})`}
              cents={e.incomeTaxCents}
            />
            {otherTaxes > 0 && <Row label="Self-employment and other taxes" cents={otherTaxes} />}
            {credits > 0 && <Row label="Credits" cents={-credits} />}
            <Row label="Total tax" cents={e.totalTaxCents} strong />
            {view.withholdingKnown && <Row label="Withheld and paid" cents={e.paidCents} />}
          </tbody>
        </table>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Your top federal rate: {Math.round(e.marginalRate * 100)}%.
          {e.state && e.state.parts.length <= 1 && stateSource(e.state.code)
            ? ` ${stateSource(e.state.code)}`
            : ""}
        </p>
        {e.state && (e.state.parts.length > 1 || e.state.local) && (
          <table className="mt-2 w-full">
            <caption className="sr-only">State and local taxes, by state</caption>
            <tbody>
              {e.state.parts.map((p) => (
                <Row
                  key={p.code}
                  label={`${stateName(p.code)}: ${
                    p.residence === "nonresident"
                      ? "nonresident, wages from your employer there"
                      : p.residence === "part_year"
                        ? `lived there ${dayLabel(p.from!, { year: true })} to ${dayLabel(p.to!, { year: true })}`
                        : `all of ${view.year}`
                  }${p.creditCents > 0 ? ", after credit for other states" : ""}`}
                  cents={p.taxCents}
                />
              ))}
              {e.state.local && (
                <Row label={`${e.state.local.label} income tax`} cents={e.state.local.taxCents} />
              )}
            </tbody>
          </table>
        )}
        {e.state && (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            State figures from{" "}
            {e.state.parts.map((p, i) => (
              <span key={p.code}>
                {i > 0 && ", "}
                {p.url ? (
                  <a
                    href={p.url}
                    className="underline underline-offset-2 hover:no-underline"
                    rel="noreferrer"
                  >
                    {STATE_SOURCES[p.code]?.agency ?? stateName(p.code)}
                  </a>
                ) : (
                  stateName(p.code)
                )}
              </span>
            ))}
            {e.state.local && (
              <>
                {", "}
                <a
                  href={e.state.local.url}
                  className="underline underline-offset-2 hover:no-underline"
                  rel="noreferrer"
                >
                  {e.state.local.source}
                </a>
              </>
            )}
            , for review.{" "}
            <a
              href="/taxes/profile#states"
              className="underline underline-offset-2 hover:no-underline"
            >
              Moved, or work for an employer in another state?
            </a>
          </p>
        )}
      </details>
      {view.assumptions.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">What Jane assumed</p>
          <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
            {view.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-zinc-500">{ESTIMATE_NOTE}</p>
    </section>
  );
}
