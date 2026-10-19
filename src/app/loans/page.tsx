import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { AssetPrompts } from "@/components/asset-prompts";
import { ViewTracker } from "@/components/view-tracker";
import { sourceLabel, type Debt } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { scopedDb } from "@/lib/db-scoped";
import { loadDebts } from "@/lib/debts";
import { formatCents } from "@/lib/money";
import { assetPrompts } from "@/lib/owned-assets";
import { requireUser } from "@/lib/session";
import { clearTerms, saveTerms } from "./actions";

// Every debt in one place (spec step 109): loans and cards with what the bank reports,
// buy now, pay later plans found from payments, and terms the person typed for what the
// bank leaves out. Every rate says where it came from. Jane's chat answers the same
// questions from the same numbers (src/lib/debts.ts).

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

const SAVED: Record<string, string> = {
  terms: "Saved. Jane counts it from now on.",
  cleared: "Cleared what you typed.",
};

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// What can be typed for a debt: anything the bank (or the payments) leave out.
const typeable = (d: Debt) => ({
  apr: d.aprFrom === null || d.aprFrom === "typed",
  minimum: d.kind !== "bnpl" && (d.paymentFrom === null || d.paymentFrom === "typed"),
  balance: d.kind === "bnpl" && (d.balanceFrom === null || d.balanceFrom === "typed"),
  payoff: d.kind !== "card" && (d.payoffFrom === null || d.payoffFrom === "typed"),
});

function TermsForm({ debt, open, error }: { debt: Debt; open: boolean; error: string }) {
  const can = typeable(debt);
  if (!can.apr && !can.minimum && !can.balance && !can.payoff) return null;
  const typed = (from: Debt["aprFrom"], value: string) => (from === "typed" ? value : "");
  return (
    <details open={open} className="text-sm">
      <summary className="cursor-pointer text-emerald-700">
        {debt.typedOn ? "Change what you typed" : "Add what your bank doesn't report"}
      </summary>
      <form action={saveTerms} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="debtKey" value={debt.key} />
        {open && error && (
          <p role="alert" className="text-amber-800 sm:col-span-2 dark:text-amber-300">
            {error}
          </p>
        )}
        {can.apr && (
          <label className="flex flex-col gap-1 font-medium">
            Rate (APR %)
            <input
              name="apr"
              className={INPUT}
              inputMode="decimal"
              placeholder="e.g. 24.99"
              defaultValue={typed(
                debt.aprFrom,
                debt.aprBps === null ? "" : (debt.aprBps / 100).toFixed(2),
              )}
            />
          </label>
        )}
        {can.minimum && (
          <label className="flex flex-col gap-1 font-medium">
            Monthly payment ($)
            <input
              name="minimum"
              className={INPUT}
              inputMode="decimal"
              defaultValue={typed(
                debt.paymentFrom,
                debt.paymentCents === null ? "" : (debt.paymentCents / 100).toFixed(2),
              )}
            />
          </label>
        )}
        {can.balance && (
          <label className="flex flex-col gap-1 font-medium">
            Left to pay ($)
            <input
              name="balance"
              className={INPUT}
              inputMode="decimal"
              defaultValue={typed(
                debt.balanceFrom,
                debt.balanceCents === null ? "" : (debt.balanceCents / 100).toFixed(2),
              )}
            />
          </label>
        )}
        {can.payoff && (
          <label className="flex flex-col gap-1 font-medium">
            Last payment
            <input
              name="payoffDate"
              type="date"
              className={INPUT}
              defaultValue={typed(debt.payoffFrom, debt.payoffDate ?? "")}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <button
            type="submit"
            className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800"
          >
            Save
          </button>
          <span className="text-zinc-500">From your statement or the lender&apos;s app.</span>
        </div>
      </form>
      {debt.typedOn && (
        <form action={clearTerms} className="mt-2">
          <input type="hidden" name="debtKey" value={debt.key} />
          <button
            type="submit"
            className="text-xs text-zinc-500 hover:text-red-700 hover:underline"
          >
            Clear what I typed
          </button>
        </form>
      )}
    </details>
  );
}

function DebtCard({ debt, open, error }: { debt: Debt; open: boolean; error: string }) {
  return (
    <li
      id={debt.key}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold break-words">{debt.name}</span>
          <span className="text-sm text-zinc-500">
            {debt.kindLabel}
            {debt.description ? ` · ${debt.description}` : ""}
          </span>
        </div>
        <span className="text-xl font-semibold">
          {debt.balanceCents === null ? "–" : formatCents(debt.balanceCents)}
        </span>
      </div>
      {debt.overdue && (
        <p
          role="status"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          Your bank shows this as overdue
          {debt.pastDueCents ? `: ${formatCents(debt.pastDueCents)} past due` : ""}.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500">Rate</dt>
          <dd>
            {debt.aprBps === null ? "Not known yet" : formatRate(debt.aprBps)}
            {debt.rateType ? ` ${debt.rateType}` : ""}
          </dd>
          {debt.aprBps !== null && (
            <dd className="text-xs text-zinc-500">{sourceLabel(debt.aprFrom, debt.typedOn)}</dd>
          )}
        </div>
        <div>
          <dt className="text-zinc-500">
            {debt.kind === "card"
              ? "Minimum"
              : debt.paymentEvery === "two_weeks"
                ? "Every two weeks"
                : "Monthly payment"}
          </dt>
          <dd>{debt.paymentCents === null ? "Not known yet" : formatCents(debt.paymentCents)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Next due</dt>
          <dd>
            {debt.nextDue === null ? "Not known yet" : dateLabel(debt.nextDue)}
            {debt.dueSoon && (
              <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                soon
              </span>
            )}
          </dd>
        </div>
        {debt.payoffDate && (
          <div>
            <dt className="text-zinc-500">Paid off by</dt>
            <dd>{dateLabel(debt.payoffDate)}</dd>
            <dd className="text-xs text-zinc-500">{sourceLabel(debt.payoffFrom, debt.typedOn)}</dd>
          </div>
        )}
      </dl>
      {debt.kind === "bnpl" && debt.balanceCents !== null && (
        <p className="text-xs text-zinc-500">
          What&apos;s left is {sourceLabel(debt.balanceFrom, debt.typedOn)}.
        </p>
      )}
      <TermsForm debt={debt} open={open} error={error} />
    </li>
  );
}

async function LoansContent({
  searchParams,
}: {
  searchParams: PageProps<"/loans">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : "";
  };
  const db = await scopedDb();
  const [book, loans, linked] = await Promise.all([
    loadDebts(user.id),
    db.accounts.findMany({
      where: { type: "loan" },
      select: { id: true, name: true, type: true, subtype: true },
    }),
    // Mortgages and car loans with a home or car linked (spec step 67).
    db.ownedAssets.findMany({ select: { loanAccountId: true } }),
  ]);
  const prompts = assetPrompts(
    loans,
    linked.map((o) => o.loanAccountId),
  );
  const accounts = book.debts.filter((d) => d.inNetWorth);
  const plans = book.debts.filter((d) => !d.inNetWorth);
  const saved = SAVED[one("saved")];
  const openKey = one("terms");
  const error = one("error");

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="loans_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Every debt</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your loans, cards and buy now, pay later plans, with the rates, payments and dates your
          bank reports. Every rate says where it came from, and Jane never guesses one.
        </p>
      </div>

      {saved && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {saved}
        </p>
      )}

      {book.debts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No loans, cards or plans yet. When you{" "}
          <Link href="/connect" className={LINK}>
            link a bank
          </Link>{" "}
          that reports them, they show here with their rates and due dates.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">You owe</span>
              <span className="text-2xl font-semibold">{formatCents(book.totalOwedCents)}</span>
              {plans.length > 0 && (
                <span className="text-xs text-zinc-500">
                  {formatCents(book.accountsOwedCents)} on loans and cards, as in your{" "}
                  <Link href="/net-worth" className={LINK}>
                    net worth
                  </Link>
                  , plus {formatCents(book.bnplOwedCents)} on buy now, pay later plans
                  {book.bnplUnknown > 0 ? ` (${book.bnplUnknown} without a balance yet)` : ""}.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Due each month</span>
              <span className="text-2xl font-semibold">{formatCents(book.monthlyCents)}</span>
              {book.missingMonthly > 0 && (
                <span className="text-xs text-zinc-500">
                  Leaves out {book.missingMonthly} without a payment yet.
                </span>
              )}
            </div>
          </section>

          <ul id="terms" aria-label="Loans and cards" className="flex flex-col gap-3">
            {accounts.map((d) => (
              <DebtCard key={d.key} debt={d} open={openKey === d.key} error={error} />
            ))}
          </ul>

          {plans.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold">Buy now, pay later</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Found from your payments to Affirm, Klarna and Afterpay. They aren&apos;t bank
                accounts, so net worth doesn&apos;t count them.
              </p>
              <ul aria-label="Buy now, pay later plans" className="flex flex-col gap-3">
                {plans.map((d) => (
                  <DebtCard key={d.key} debt={d} open={openKey === d.key} error={error} />
                ))}
              </ul>
            </section>
          )}

          <AssetPrompts prompts={prompts} />

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Own a home or a car?{" "}
            <Link href="/things" className={LINK}>
              Things you own
            </Link>{" "}
            shows what you own of it, from the values you give.
          </p>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            How do your debts look to lenders?{" "}
            <Link href="/loans/credit" className={LINK}>
              See your credit score
            </Link>
            .
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Which card earns most on what you buy?{" "}
            <Link href="/loans/cards" className={LINK}>
              See your card rewards
            </Link>
            .
          </p>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Own a home with a mortgage?{" "}
            <Link href="/loans/mortgage" className={LINK}>
              See PMI, escrow and extra payments
            </Link>
            .
          </p>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Have a federal student loan?{" "}
            <Link href="/loans/student" className={LINK}>
              Compare its repayment plans
            </Link>
            .
          </p>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Could a loan cost less?{" "}
            <Link href="/loans/refinance" className={LINK}>
              See refinance offers
            </Link>
            , checked every month.
          </p>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Want to see how paying them down could go?{" "}
            <Link href="/debt" className={LINK}>
              Try the payoff planner
            </Link>
            . Your statements are the source of truth.
          </p>
        </>
      )}
    </>
  );
}

export default function LoansPage({ searchParams }: PageProps<"/loans">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <LoansContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
