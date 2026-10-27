import type { AccountSummary } from "@/lib/accounts";
import { formatCents } from "@/lib/money";
import { dayLabel } from "@/lib/day-label";

export function AccountList({ accounts }: { accounts: AccountSummary[] }) {
  if (accounts.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">No accounts yet.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {accounts.map((account) => (
        <li
          key={account.id}
          className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
        >
          <div>
            <p className="font-medium" data-private>
              {account.name}
            </p>
            <p className="text-sm text-zinc-500">
              {account.kindLabel} · {account.transactionCount} transactions
              {account.firstDate &&
                account.lastDate &&
                ` · ${dayLabel(account.firstDate, { year: true })} to ${dayLabel(account.lastDate, { year: true })}`}
            </p>
          </div>
          <p className="text-right">
            <span className="block text-xs text-zinc-500">
              {account.kind === "credit_card" ? "Balance owed" : "Current balance"}
            </span>
            <span className="font-semibold">
              {account.currentBalanceCents === null
                ? "Not entered"
                : formatCents(account.currentBalanceCents)}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
