import { LinkButton } from "@/app/connect/link-button";
import type { BankNotice } from "@/lib/plaid/bank-status";

// A linked bank that needs something, said calmly: sign in again (Link's update mode), share
// new accounts, or wait out an outage, each with how old the data is.
const BUTTON =
  "inline-flex h-10 items-center justify-center self-start rounded-full border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function BankStatusNotice({ notices }: { notices: readonly BankNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="Your banks" className="flex flex-col gap-2">
      {notices.map((n) => (
        <aside
          key={`${n.kind}:${n.itemId}`}
          role="note"
          data-bank-notice={n.kind}
          className="flex flex-col gap-2 rounded-xl border border-zinc-300 p-3 text-sm dark:border-zinc-700"
        >
          <strong>{n.title}</strong>
          <p className="text-zinc-600 dark:text-zinc-400">{n.words}</p>
          {n.action && <LinkButton itemId={n.itemId} label={n.action} className={BUTTON} />}
        </aside>
      ))}
    </section>
  );
}
