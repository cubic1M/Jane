import type { ReactNode, TableHTMLAttributes } from "react";

// The team pages' table: a header row, then one row per item, ruled between rows. The last
// column has no right padding.

export type AdminRow = { key: string; cells: ReactNode[] };

export function AdminTable({
  head,
  rows,
  className = "",
  ...rest
}: { head: ReactNode[]; rows: AdminRow[] } & TableHTMLAttributes<HTMLTableElement>) {
  const pad = (i: number, n: number) => (i === n - 1 ? "py-2" : "py-2 pr-4");
  return (
    <table className={`w-full text-left text-sm ${className}`.trim()} {...rest}>
      <thead>
        <tr className="border-b border-zinc-200 dark:border-zinc-800">
          {head.map((h, i) => (
            <th key={i} className={`${pad(i, head.length)} font-semibold`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-zinc-100 dark:border-zinc-900">
            {row.cells.map((cell, i) => (
              <td key={i} className={pad(i, row.cells.length)}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
