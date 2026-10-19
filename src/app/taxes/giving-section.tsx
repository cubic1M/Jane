import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { GivingView } from "@/lib/giving";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { GivingButton } from "./giving-buttons";

// Giving on /taxes (spec step 168): the year's gifts and their receipts, and in demo advice
// mode the options that do more good for the same money, each as the tax with and without
// it, with a donor-advised fund through the stand-in.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function GivingSection({ view }: { view: GivingView }) {
  return (
    <section aria-labelledby="giving-heading" id="giving" className={CARD}>
      <h2 id="giving-heading" className="text-xl font-semibold">
        Giving
      </h2>
      {view.gifts.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No gifts to charity found for {view.year} yet.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {formatCents(view.totalCents)} given in {view.year}. Gifts of $250 or more need the
            charity&apos;s written receipt.
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {view.gifts.map((g) => (
              <li key={g.transactionId} className="flex flex-col gap-1">
                <span className="flex flex-wrap justify-between gap-x-3">
                  <span className="[overflow-wrap:anywhere]">
                    {day(g.date)}: {g.payee}
                  </span>
                  <span className="whitespace-nowrap">{formatCents(g.cents)}</span>
                </span>
                {g.needsReceipt &&
                  (g.receipted ? (
                    <span className="text-zinc-600 dark:text-zinc-400">Receipt: you have it.</span>
                  ) : (
                    <GivingButton
                      intent="receipt"
                      gift={g.transactionId}
                      label="I have the receipt"
                      ariaLabel={`I have the receipt: ${g.payee}, ${formatCents(g.cents)}`}
                    />
                  ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {view.fund && (
        <p className="text-sm">
          Your donor-advised fund: {view.fund.name}, opened {day(view.fund.openedAt)} (a stand-in
          for now).
        </p>
      )}
      {view.advice && view.options.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">More good for the same money</h3>
          <table className="w-full text-sm">
            <caption className="sr-only">
              Each option&apos;s federal tax, with and without it
            </caption>
            <thead>
              <tr className="text-left text-zinc-600 dark:text-zinc-400">
                <th scope="col" className="py-1 pr-2 font-normal">
                  Option
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-normal">
                  Tax with it
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-normal">
                  Without
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Saves
                </th>
              </tr>
            </thead>
            <tbody>
              {view.options.map((o) => (
                <tr key={o.key} className="border-t border-zinc-200 dark:border-zinc-800">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    {o.title}
                    <span className="block text-xs text-zinc-600 dark:text-zinc-400">{o.why}</span>
                  </th>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    {roundDollars(o.withCents)}
                  </td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    {roundDollars(o.withoutCents)}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {roundDollars(o.savesCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Federal tax over the years compared, estimated, with your income held the same.
          </p>
          {!view.fund && view.options.some((o) => o.key === "fund") && (
            <GivingButton
              intent="fund"
              label="Open a donor-advised fund"
              ariaLabel="Open a donor-advised fund"
            />
          )}
          <DemoAdviceLabel />
        </div>
      )}
    </section>
  );
}
