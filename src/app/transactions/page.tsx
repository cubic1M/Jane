import Link from "next/link";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { cardPaymentNames } from "@/categorize/card-payments";
import { normalizeMerchant } from "@/data-sources/merchant";
import { categoryLabel } from "@/insights/labels";
import { categoryOptions, detailedLabel, listMerchantRules } from "@/lib/categories";
import { scopedDb } from "@/lib/db-scoped";
import { isoDay } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { deleteRule } from "./actions";
import { CategoryForm } from "./category-form";
import { SubmitButton } from "@/components/submit-button";

const SHOWN = 100;

async function Transactions({
  searchParams,
}: {
  searchParams: PageProps<"/transactions">["searchParams"];
}) {
  const user = await requireUser();
  const db = await scopedDb();
  const { q, day, from, to } = await searchParams;
  const search = typeof q === "string" ? q.trim() : "";
  // A day, or days, from the net worth chart's dots: ?day=2026-10-05, or ?from=…&to=….
  const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const first = isDay(day) ? day : isDay(from) ? from : null;
  const last = isDay(day) ? day : isDay(to) ? to : first;
  const [rows, rules, accounts, cardPayments] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        ...(first && last
          ? {
              date: {
                gte: new Date(`${first}T00:00:00Z`),
                lte: new Date(`${last}T00:00:00Z`),
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { merchantName: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcPrimary: true,
        pfcDetailed: true,
        categorySource: true,
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: SHOWN,
    }),
    listMerchantRules(user.id),
    db.accounts.findMany({ select: { id: true, type: true, name: true } }),
    // Every card payment, so each one shown is named for the card it paid, even when the
    // other side is off this page.
    db.transactions.findMany({
      where: { pending: false, pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" },
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        pfcDetailed: true,
      },
    }),
  ]);
  const groups = categoryOptions();
  const paymentNames = cardPaymentNames(
    cardPayments.map((r) => ({ ...r, date: isoDay(r.date) })),
    accounts,
  );

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Fix a category here, for one transaction or for every one at that merchant. Insights,
          findings and Ask Jane use your choice.
        </p>
      </div>

      <form className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search by merchant
        </label>
        <input
          id="q"
          name="q"
          defaultValue={search}
          placeholder="Search by merchant"
          className="h-11 min-w-0 flex-1 rounded-full border border-zinc-300 bg-transparent px-4 dark:border-zinc-700"
        />
        <button
          type="submit"
          className="h-11 rounded-full border border-zinc-300 px-5 font-semibold dark:border-zinc-700"
        >
          Search
        </button>
      </form>

      {first && last && (
        <p data-transactions-days="" className="text-sm text-zinc-600 dark:text-zinc-400">
          {first === last
            ? `On ${dayLabel(first, { year: true })}.`
            : `From ${dayLabel(first)} to ${dayLabel(last, { year: true })}.`}{" "}
          <Link href="/transactions" className="font-medium underline">
            All transactions
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          {search || first ? (
            "No transactions found."
          ) : (
            <>
              No transactions yet.{" "}
              <Link href="/import" className="font-medium underline">
                Upload a bank or card statement
              </Link>{" "}
              and they show here.
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((t) => {
            const merchant =
              paymentNames.get(t.id) ??
              t.merchantName ??
              normalizeMerchant(t.description)?.name ??
              t.description;
            const category =
              t.pfcPrimary && t.pfcDetailed
                ? `${categoryLabel(t.pfcPrimary)} · ${detailedLabel(t.pfcPrimary, t.pfcDetailed)}`
                : "Uncategorized";
            return (
              <li key={t.id} className="px-4 py-3 [overflow-wrap:anywhere]">
                <details>
                  <summary className="flex cursor-pointer flex-wrap justify-between gap-2">
                    <span className="flex flex-col">
                      <span className="font-medium">{merchant}</span>
                      <span className="text-xs text-zinc-500">
                        <time dateTime={isoDay(t.date)}>{dayLabel(t.date, { year: true })}</time> ·{" "}
                        {category}
                        {t.categorySource === "user" && " (yours)"}
                      </span>
                    </span>
                    <span className={t.amountCents < 0 ? "text-emerald-700" : ""}>
                      {t.amountCents < 0 ? "+" : ""}
                      {formatCents(Math.abs(t.amountCents))}
                    </span>
                  </summary>
                  <CategoryForm transactionId={t.id} current={t.pfcDetailed} groups={groups} />
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {rules.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Your merchant rules</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {rules.map((r) => (
              <li key={r.merchantKey} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {r.merchantKey} → {categoryLabel(r.pfcPrimary)} ·{" "}
                  {detailedLabel(r.pfcPrimary, r.pfcDetailed)}
                </span>
                <form action={deleteRule}>
                  <input type="hidden" name="merchantKey" value={r.merchantKey} />
                  <SubmitButton className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
                    Remove rule
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Transactions searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
