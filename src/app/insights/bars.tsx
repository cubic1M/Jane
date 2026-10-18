import { formatCents } from "@/lib/money";

// Bar charts drawn with plain elements: each bar has a text label and value, so the chart
// reads the same to a screen reader, and it fits any width.

export function MonthBars({
  months,
}: {
  months: { month: string; spendingCents: number; incomeCents: number }[];
}) {
  const max = Math.max(1, ...months.flatMap((m) => [m.spendingCents, m.incomeCents]));
  const label = (month: string) =>
    new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-40 items-end gap-1" aria-hidden>
        {months.map((m) => (
          <div key={m.month} className="flex h-full flex-1 items-end gap-px">
            <div
              className="flex-1 rounded-t bg-emerald-600"
              style={{ height: `${(m.incomeCents / max) * 100}%` }}
            />
            <div
              className="flex-1 rounded-t bg-zinc-400 dark:bg-zinc-500"
              style={{ height: `${(m.spendingCents / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 text-[10px] text-zinc-500" aria-hidden>
        {months.map((m) => (
          <span key={m.month} className="flex-1 text-center">
            {label(m.month)}
          </span>
        ))}
      </div>
      <p className="flex gap-4 text-xs text-zinc-600 dark:text-zinc-400" aria-hidden>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-600" />
          Income
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-zinc-400" />
          Spending
        </span>
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
          Show as a table
        </summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Income</th>
              <th scope="col">Spending</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row" className="font-normal">
                  {m.month}
                </th>
                <td>{formatCents(m.incomeCents)}</td>
                <td>{formatCents(m.spendingCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function HorizontalBars({ rows }: { rows: { label: string; cents: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <span className="flex justify-between gap-2 text-sm">
            <span>{r.label}</span>
            <span className="font-medium">{formatCents(r.cents)}</span>
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
