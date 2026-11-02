import Link from "next/link";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { plaidEnabled } from "@/lib/plaid/client";
import { demoBankEnabled } from "@/lib/plaid/demo";
import { bankNotices, updatedAgo } from "@/lib/plaid/bank-status";
import { linkAvailability } from "@/lib/plaid/item-slots";
import { requireUser } from "@/lib/session";
import { linkDemo } from "./demo-actions";
import { LinkButton } from "./link-button";
import { LinkChoice, Promises, SECONDARY_BUTTON } from "./link-choice";
import { SubmitButton } from "@/components/submit-button";
import { SUGGESTED_UPLOAD_MONTHS, UPLOAD_REASSURANCE } from "@/config/import";

const PRIMARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 sm:w-auto";

async function ConnectContent() {
  const user = await requireUser();
  const db = await scopedDb();
  // The closed beta leads with uploading statements (founder: linking feels scary); linking a
  // bank is the smaller second choice. Trial people (sample data) can't upload, so they see
  // linking and the demo bank as before.
  const uploadFirst = canImportCsv(user);
  const [items, uploadedAccounts, link] = await Promise.all([
    db.plaidItems.findMany({
      select: {
        id: true,
        institutionName: true,
        status: true,
        lastSyncedAt: true,
        newAccountsAvailable: true,
        lastErrorCode: true,
        accounts: { select: { id: true, name: true, mask: true }, orderBy: { name: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    uploadFirst ? db.accounts.count({ where: { source: "csv" } }) : 0,
    linkAvailability(user.id),
  ]);
  const now = new Date();
  const notices = bankNotices(
    items.map((i) => ({ ...i, name: i.institutionName })),
    now,
  );

  return (
    <>
      <AppHeader user={user} />
      {uploadFirst ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Add your accounts</h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Jane reads the transactions from the checking, savings and credit card accounts you
              use most to find money you&apos;re losing.
            </p>
          </div>
          <section
            data-upload-first=""
            className="flex flex-col gap-3 rounded-xl border-2 border-zinc-900 p-5 dark:border-zinc-100"
          >
            <h2 className="text-xl font-semibold">Upload your statements</h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              Download the last {SUGGESTED_UPLOAD_MONTHS} months of transactions from your
              bank&apos;s website and upload the files. We show you how for each bank.
            </p>
            <p className="text-sm font-medium">{UPLOAD_REASSURANCE}</p>
            <Link href="/import" className={PRIMARY_BUTTON + " self-start"}>
              {uploadedAccounts > 0 ? "Upload more statements" : "Upload your statements"}
            </Link>
          </section>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Connect your accounts</h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Link the checking, savings and credit card accounts you use most. We read the last
              year of transactions to find money you&apos;re losing.
            </p>
          </div>
          <Promises />
        </>
      )}

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
                      ? `Updated ${updatedAgo(item.lastSyncedAt, now)}`
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
                {notices
                  .filter((n) => n.itemId === item.id)
                  .map((n) => (
                    <div
                      key={n.kind}
                      data-bank-notice={n.kind}
                      className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700"
                    >
                      <strong>{n.title}</strong>
                      <p className="text-zinc-600 dark:text-zinc-400">{n.words}</p>
                      {n.action && (
                        <LinkButton
                          itemId={item.id}
                          label={n.action}
                          className={SECONDARY_BUTTON}
                        />
                      )}
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <LinkChoice
          plaidOn={plaidEnabled()}
          uploadFirst={uploadFirst}
          linkOpen={link.open}
          hasBanks={items.length > 0}
          demoOn={demoBankEnabled()}
          primaryClassName={PRIMARY_BUTTON}
        />
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
            <SubmitButton className={SECONDARY_BUTTON + " self-start"}>
              Link a demo bank
            </SubmitButton>
          </form>
        )}
        {(items.length > 0 || uploadedAccounts > 0) && (
          <Link href="/scanning" className="font-medium text-emerald-700 hover:underline">
            Continue to your report
          </Link>
        )}
      </section>
    </>
  );
}

export default function ConnectPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <ConnectContent />
      </Suspense>
    </main>
  );
}
