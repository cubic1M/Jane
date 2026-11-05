import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import type { TaxSetAsideView } from "@/lib/tax-set-aside";
import { NOTHING_KEPT_APART, SOURCE_WORDS, type TaxLine } from "@/planning/tax-set-aside";
import { NotIncomeButton, PointOutForm, UndoButton } from "./set-aside-forms";

// The tax left to cover on /taxes, line by line: each line says whether it's seen, estimated or
// assumed, and where it came from on a tap. Arithmetic on the person's own numbers, for real
// accounts; "set aside" only in demo advice, with its label.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const SUMMARY = "cursor-pointer font-medium underline underline-offset-2";
const PAYERS_SHOWN = 12;

const signed = (l: TaxLine) =>
  l.cents === null
    ? "Not known"
    : `${l.sign === "−" && l.cents > 0 ? "−" : ""}${formatCents(l.cents)}`;

function Line({ line }: { line: TaxLine }) {
  const total = line.sign === "=";
  return (
    <tr className="border-t border-zinc-200 align-top dark:border-zinc-800">
      <th scope="row" className={`py-1 pr-2 text-left ${total ? "font-semibold" : "font-normal"}`}>
        <details>
          <summary className="cursor-pointer">
            {line.label}{" "}
            <span className="text-xs font-normal text-zinc-500">{SOURCE_WORDS[line.source]}</span>
          </summary>
          <span className="block text-xs font-normal text-zinc-600 dark:text-zinc-400">
            {line.from}
          </span>
        </details>
      </th>
      <td className={`py-1 text-right whitespace-nowrap ${total ? "font-semibold" : ""}`}>
        {signed(line)}
      </td>
    </tr>
  );
}

const headline = (view: TaxSetAsideView) => {
  if (view.status === "needed") {
    const cents = formatWholeDollars(view.holdCents);
    return view.advice
      ? `Set aside about ${cents} for your ${view.year} tax so far.`
      : `About ${cents} of your ${view.year} tax so far isn't withheld or paid yet.`;
  }
  if (view.status === "unknown")
    return "Jane can't say what's left: it can see your paychecks, not what's withheld from them.";
  if (view.status === "no_income") return "No income for this year in your accounts yet.";
  return "What's withheld and paid covers your tax so far.";
};

export function SetAsideSection({ view }: { view: TaxSetAsideView }) {
  const { corrections, soFar } = view.estimateView;
  return (
    <section aria-labelledby="set-aside-heading" id="set-aside" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="set-aside-heading" className="text-xl font-semibold">
          {view.advice ? "Tax to set aside" : "Tax not yet paid"}
        </h2>
        <span className="border border-zinc-400 px-2 py-0.5 text-xs font-medium dark:border-zinc-600">
          Estimate, {view.confidence.percent}% sure
        </span>
      </div>
      <p className="text-lg">{headline(view)}</p>
      {view.status === "needed" && view.keptApartCents === 0 && (
        <p className="text-sm font-medium">{NOTHING_KEPT_APART}</p>
      )}
      {view.unknowns.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          {view.unknowns.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
      <details className="text-sm">
        <summary className={SUMMARY}>Show the calculation</summary>
        <table className="mt-2 w-full">
          <caption className="sr-only">The tax left to cover, line by line</caption>
          <tbody>
            {view.lines.map((l) => (
              <Line key={l.key} line={l} />
            ))}
          </tbody>
        </table>
      </details>
      {corrections.length > 0 && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">What you pointed out</p>
          <ul className="flex flex-col gap-2">
            {corrections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="[overflow-wrap:anywhere]">
                  {c.kind === "not_income" ? `${c.label}: not income` : c.label}
                  {c.cents !== null && `, ${formatCents(c.cents)}`}
                </span>
                <UndoButton id={c.id} label={c.label} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-sm">
        <summary className={SUMMARY}>Point something out</summary>
        <div className="mt-2 flex flex-col gap-4">
          {soFar.payers.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Income Jane counted">
              {soFar.payers.slice(0, PAYERS_SHOWN).map((p) => (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="[overflow-wrap:anywhere]">
                    {p.label}, {formatCents(p.cents)}
                  </span>
                  <NotIncomeButton payerKey={p.key} label={p.label} />
                </li>
              ))}
            </ul>
          )}
          <PointOutForm />
        </div>
      </details>
      {view.advice ? (
        <DemoAdviceLabel />
      ) : (
        <p className="text-xs text-zinc-500">
          Arithmetic on your own numbers: an estimate, not tax advice. You might be able to deduct
          more or less; check with a tax professional.
        </p>
      )}
    </section>
  );
}
