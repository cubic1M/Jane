import { formatCents } from "@/lib/money";

// Bars drawn with plain elements: each has a text label, its value and, given a total, its
// share, so it reads the same to a screen reader and fits any width. The insights page's own
// rows, which open to their transactions, are in ./explorer.tsx.

export function HorizontalBars({
  rows,
  totalCents,
}: {
  rows: { label: string; cents: number }[];
  totalCents?: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <span className="flex justify-between gap-2 text-sm">
            <span>{r.label}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium">{formatCents(r.cents)}</span>
              {totalCents ? (
                <span className="ml-1.5 inline-block w-9 text-right text-xs text-zinc-600 dark:text-zinc-400">
                  {r.cents < totalCents / 200
                    ? "<1%"
                    : `${Math.round((r.cents / totalCents) * 100)}%`}
                </span>
              ) : null}
            </span>
          </span>
          <span className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
            <span
              className="block h-2 rounded-full bg-emerald-600"
              style={{ width: `${(r.cents / max) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
