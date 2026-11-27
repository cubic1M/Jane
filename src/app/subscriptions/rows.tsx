import Link from "next/link";
import { type RecurringCharge } from "@/detection/subscriptions";
import { dayLabel } from "@/lib/day-label";
import { frequencyWords } from "@/lib/explain-input";
import { formatCents } from "@/lib/money";
import { chargeAnchor } from "@/lib/recurring-marks";

const day = (iso: string | null) => (iso ? dayLabel(iso, { year: true }) : "–");

export function Rows({ rows, cards }: { rows: RecurringCharge[]; cards: Map<string, string> }) {
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map((r) => (
        <li
          key={r.key}
          id={chargeAnchor(r.key)}
          className="flex scroll-mt-24 flex-wrap items-start justify-between gap-2 px-4 py-3 target:bg-zinc-50 dark:target:bg-zinc-900 [overflow-wrap:anywhere]"
        >
          <span className="flex flex-col">
            <span className="font-medium">{r.merchant}</span>
            <span className="text-xs text-zinc-500">
              {formatCents(r.lastAmountCents)} {frequencyWords(r.frequency)} · last{" "}
              {day(r.lastDate)} · next {day(r.nextDate)}
            </span>
            {cards.has(r.key) && (
              <Link
                href={`/report/${cards.get(r.key)}`}
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                Cancel or review
              </Link>
            )}
          </span>
          <span className="font-medium">{formatCents(r.annualCostCents)} a year</span>
        </li>
      ))}
    </ul>
  );
}
