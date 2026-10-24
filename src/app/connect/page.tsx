import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { plaidEnabled } from "@/lib/plaid/client";
import { demoBankEnabled } from "@/lib/plaid/demo";
import { ITEM_STATUS } from "@/lib/plaid/sync";
import { requireUser } from "@/lib/session";
import { linkDemo } from "./demo-actions";
import { LinkButton } from "./link-button";

const PRIMARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 sm:w-auto";
const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const PROMISES = [
  ["Read-only", "We can see transactions and balances. We can never move your money."],
  ["Through Plaid", "You sign in to your bank in Plaid's window. We never see your password."],
  ["Disconnect anytime", "Remove a bank or delete all your data whenever you want."],
];

async function ConnectContent() {
  const user = await requireUser();
  const db = await scopedDb();
  const [items, csvAllowed] = await Promise.all([
    db.plaidItems.findMany({
      select: {
        id: true,
        institutionName: true,
        status: true,
        lastSyncedAt: true,
        accounts: { select: { id: true, name: true, mask: true }, orderBy: { name: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    canImportCsv(user, db),
  ]);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Connect your accounts</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Link the checking, savings and credit card accounts you use most. We read the last year of
          transactions to find money you&apos;re losing.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {PROMISES.map(([title, body]) => (
          <li key={title} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
          </li>
        ))}
      </ul>

      {items.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Linked banks</h2>
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{item.institutionName ?? "Your bank"}</p>
                  <p className="text-xs text-zinc-500">
                    {item.lastSyncedAt
                      ? `Updated ${item.lastSyncedAt.toISOString().slice(0, 10)}`
                      : "Reading your transactions…"}
                  </p>
                </div>
                {item.accounts.length > 0 && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {item.accounts
                      .map((a) => (a.mask ? `${a.name} ····${a.mask}` : a.name))
                      .join(", ")}
                  </p>
                )}
                {item.status === ITEM_STATUS.loginRequired && (
                  <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-950">
                    <p className="text-sm">
                      Your bank needs you to sign in again before we can read new transactions.
                    </p>
                    <LinkButton itemId={item.id} label="Reconnect" className={SECONDARY_BUTTON} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        {plaidEnabled() ? (
          <LinkButton
            label={items.length > 0 ? "Add another account" : "Link an account"}
            className={PRIMARY_BUTTON}
          />
        ) : (
          !demoBankEnabled() && (
            <p className="text-zinc-600 dark:text-zinc-400">Bank linking isn&apos;t set up yet.</p>
          )
        )}
        {demoBankEnabled() && (
          <form
            action={linkDemo}
            className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
          >
            <p className="font-semibold">Try Jane with a demo bank</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              A pretend bank with a year of fake transactions, a card and loans, so you can see
              everything Jane does. Nothing real is connected, and you can remove it anytime.
            </p>
            <button type="submit" className={SECONDARY_BUTTON + " self-start"}>
              Link a demo bank
            </button>
          </form>
        )}
        {items.length > 0 && (
          <Link href="/scanning" className="font-medium text-emerald-700 hover:underline">
            Continue to your report
          </Link>
        )}
        {csvAllowed && (
          <Link href="/import" className="text-sm text-zinc-500 hover:underline">
            Import CSV files instead
          </Link>
        )}
      </section>
    </>
  );
}

export default function ConnectPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ConnectContent />
      </Suspense>
    </main>
  );
}
