import Link from "next/link";
import { normalizeMerchant } from "@/data-sources/merchant";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { plural } from "@/lib/plural";
import { feeKindOf, type BankFees } from "@/planning/bank-fees";

// The fees the bank-fees card counts, as it counts them (src/detectors/bank-fees-of.ts): each with
// its day, kind, account and amount, a fee given back as money in, and the total the card says.
export function FeeList({
  fees,
  accounts,
}: {
  fees: BankFees | null;
  accounts: ReadonlyMap<string, string>;
}) {
  if (!fees) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        No bank fees in the last 12 months.{" "}
        <Link href="/transactions" className="font-medium underline">
          All transactions
        </Link>
      </p>
    );
  }
  const months =
    fees.monthsOfData >= 12 ? "the last 12 months" : plural(fees.monthsOfData, "month");
  return (
    <section data-fee-list="" className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">Bank fees</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {formatCents(fees.seenCents)} in {plural(fees.count, "fee")} in {months}
        {fees.estimated && `, about ${formatCents(fees.yearCents)} over a year`}.{" "}
        <Link href="/transactions" className="font-medium underline">
          All transactions
        </Link>
      </p>
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {fees.lines.map((t, i) => {
          const back = t.amountCents < 0;
          const kind = feeKindOf(t).replace(/^an? /, "");
          return (
            <li
              key={`${t.date}:${i}`}
              data-fee-cents={t.amountCents}
              className="flex flex-wrap justify-between gap-2 px-4 py-3 [overflow-wrap:anywhere]"
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {back ? "Fee given back" : kind[0]!.toUpperCase() + kind.slice(1)}
                </span>
                <span className="text-xs text-zinc-500">
                  <time dateTime={t.date}>{dayLabel(t.date, { year: true })}</time> ·{" "}
                  {accounts.get(t.accountId ?? "") ?? "your account"} ·{" "}
                  <span data-private>
                    {normalizeMerchant(t.description)?.name ?? t.description}
                  </span>
                </span>
              </span>
              <span className={back ? "text-emerald-700" : ""}>
                {back ? "+" : ""}
                {formatCents(Math.abs(t.amountCents))}
              </span>
            </li>
          );
        })}
        <li className="flex justify-between gap-2 px-4 py-3 font-semibold">
          <span>In all</span>
          <span data-fee-total={fees.seenCents}>{formatCents(fees.seenCents)}</span>
        </li>
      </ul>
    </section>
  );
}
