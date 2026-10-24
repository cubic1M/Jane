import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AreaPage } from "@/components/area-page/area-page";
import { AssetPrompts } from "@/components/asset-prompts";
import { ViewTracker } from "@/components/view-tracker";
import { sourceLabel, type Debt } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { areaOfCapability } from "@/config/areas";
import { itemId, loansTree, type LoansBranch } from "@/lib/area-pages/loans";
import { loadCredit } from "@/lib/credit";
import { loadDebtReview } from "@/lib/debt-review";
import { loadPayoff } from "@/lib/debt-plan";
import { scopedDb } from "@/lib/db-scoped";
import { loadBnpl } from "@/lib/bnpl";
import { loadDebts } from "@/lib/debts";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { assetPrompts } from "@/lib/owned-assets";
import { requireUser } from "@/lib/session";
import { clearTerms, saveTerms } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Every debt in one place (spec step 109): loans and cards with what the bank reports,
// buy now, pay later plans found from payments, and terms the person typed for what the
// bank leaves out. Every rate says where it came from. Jane's chat answers the same
// questions from the same numbers (src/lib/debts.ts).

// Black, white and grey only (founder, 2026-10-24): links read by their underline.
const LINK = "font-medium underline underline-offset-2 hover:no-underline";
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
      <summary className="cursor-pointer font-medium underline underline-offset-2">
        {debt.typedOn ? "Change what you typed" : "Add what your bank doesn't report"}
      </summary>
      <form action={saveTerms} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="debtKey" value={debt.key} />
        {open && error && (
          <p role="alert" className="font-medium sm:col-span-2">
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
          <SubmitButton className="h-11 rounded-full bg-zinc-900 px-5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            Save
          </SubmitButton>
          <span className="text-zinc-500">From your statement or the lender&apos;s app.</span>
        </div>
      </form>
      {debt.typedOn && (
        <form action={clearTerms} className="mt-2">
          <input type="hidden" name="debtKey" value={debt.key} />
          <SubmitButton className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
            Clear what I typed
          </SubmitButton>
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
      {/* Overdue is said in the tree item's summary, with the amount past due. */}
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
              <span className="ml-1 border border-zinc-400 px-1.5 text-xs">soon</span>
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

// Every loans and credit page, by where it lives in the tree; the tree's details link to them
// with these words, and the closed list at the bottom keeps every one a tap away.
const PAGES: { href: string; label: string; what: string }[] = [
  { href: "/debt", label: "Try the payoff planner", what: "Paying it off" },
  { href: "/loans/refinance", label: "See refinance offers", what: "Refinance offers" },
  { href: "/loans/student", label: "Compare its repayment plans", what: "Student loans" },
  { href: "/loans/mortgage", label: "See PMI, escrow and extra payments", what: "Your mortgage" },
  { href: "/loans/equity", label: "Your home loan, used well", what: "Your home loan" },
  { href: "/loans/recast", label: "Recast, refinance or pay extra", what: "Extra mortgage money" },
  {
    href: "/loans/auto",
    label: "Check for a cheaper loan and dealer add-ons to cancel",
    what: "Your car loan",
  },
  { href: "/loans/interest", label: "Cut it without a new card", what: "Card interest" },
  { href: "/loans/costly", label: "See what they cost and the way out", what: "Costly borrowing" },
  { href: "/loans/tight", label: "See the plan", what: "When money is tight" },
  { href: "/loans/help", label: "See the options, plainly", what: "When debt is too much" },
  { href: "/loans/medical", label: "Check it before you pay", what: "Medical bills" },
  { href: "/loans/report", label: "Fix your report", what: "Your credit report" },
  { href: "/loans/credit", label: "See your credit score", what: "Credit score" },
  { href: "/loans/goal", label: "Plan it month by month", what: "A score for a goal" },
  {
    href: "/loans/borrow",
    label: "See what you could get, and at what rate",
    what: "What you could borrow",
  },
  { href: "/loans/home", label: "Plan it from saving to closing", what: "Buying a home" },
  { href: "/loans/car", label: "Plan it before the dealer", what: "Buying a car" },
  { href: "/loans/cards", label: "See your card rewards", what: "Card rewards" },
  { href: "/loans/family", label: "Keep track kindly", what: "Family and friends" },
  {
    href: "/loans/helping",
    label: "See what it does to both of you",
    what: "Helping family with credit",
  },
  {
    href: "/loans/renting",
    label: "Build credit with it and track your deposit",
    what: "Your rent",
  },
  { href: "/loans/review", label: "Your debt review", what: "Debt review" },
];
const PAGE = Object.fromEntries(PAGES.map((p) => [p.href, p]));

// The page each suggestion's topic is worked on.
const TOPIC_PAGE: Record<string, string> = {
  card_interest: "/loans/interest",
  high_cost_loans: "/loans/costly",
  cash_advance: "/loans/costly",
  balance_transfer: "/loans/refinance",
  consolidation: "/loans/refinance",
  bnpl: "/loans",
  medical_bills: "/loans/medical",
  credit_report_errors: "/loans/report",
  refinance: "/loans/refinance",
  auto_refinance: "/loans/auto",
  car_addons: "/loans/auto",
  student_repayment: "/loans/student",
  student_forgiveness: "/loans/student",
  mortgage_extra: "/loans/recast",
  pmi_removal: "/loans/mortgage",
  debt_plan: "/debt",
  hardship_plan: "/loans/help",
  credit_building: "/loans/credit",
  borrowing_power: "/loans/borrow",
  family_loans: "/loans/family",
  family_credit: "/loans/helping",
  cosign_risk: "/loans/helping",
  rent_reporting: "/loans/renting",
  rent_increase: "/loans/renting",
};

function PageLink({ href }: { href: string }) {
  const page = PAGE[href];
  if (!page) return null;
  return (
    <Link href={href} className={`self-start text-sm ${LINK}`}>
      {page.label} ›
    </Link>
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
  const book = await loadDebts(user.id);
  const [loans, linked, bnpl, suggestions, payoff, credit, review] = await Promise.all([
    db.accounts.findMany({
      where: { type: "loan" },
      select: { id: true, name: true, type: true, subtype: true },
    }),
    // Mortgages and car loans with a home or car linked (spec step 67).
    db.ownedAssets.findMany({ select: { loanAccountId: true } }),
    // Spec step 176: the plans' installments over the next month.
    loadBnpl(user.id, { book }),
    db.suggestions.findMany({
      where: { status: { in: ["waiting", "selected"] } },
      select: {
        key: true,
        capability: true,
        topic: true,
        short: true,
        why: true,
        worthCents: true,
        worthKind: true,
        urgency: true,
        actionLabel: true,
        actionHref: true,
      },
      orderBy: { score: "desc" },
    }),
    loadPayoff(user.id, { book }),
    loadCredit(user.id, { book }),
    loadDebtReview(user.id, { book }),
  ]);
  const prompts = assetPrompts(
    loans,
    linked.map((o) => o.loanAccountId),
  );
  const mine = suggestions.filter((s) => areaOfCapability(s.capability) === "loans");
  const accounts = book.debts.filter((d) => d.inNetWorth);
  const plans = book.debts.filter((d) => !d.inNetWorth);
  const saved = SAVED[one("saved")];
  const openKey = one("terms");
  const error = one("error");
  const latest = credit.available ? credit.latest : null;

  const area = loansTree({
    asOf: new Date().toISOString().slice(0, 10),
    debts: [...accounts, ...plans],
    suggestions: mine,
    installments: bnpl.installments.length,
    payoff: book.debts.length > 0 ? { debtFreeMonth: payoff.debtFreeMonth } : null,
    credit: latest
      ? {
          score: latest.score,
          share: latest.utilisation?.share ?? null,
          toUnderHighCents: latest.utilisation?.toUnderHighCents ?? 0,
        }
      : null,
    review: review.available
      ? {
          needYou: review.items.filter((i) => i.status === "tap").length,
          on: review.review?.on ?? null,
        }
      : null,
  });

  const details: Record<string, ReactNode> = {};
  const more: Record<string, ReactNode> = {};
  for (const sug of mine) {
    const branch = area.tree.branches.find((b) =>
      b.items.some((i) => i.id.endsWith(`:${sug.topic}`)),
    );
    if (!branch) continue;
    const id = itemId(branch.id as LoansBranch, sug.topic);
    const page = TOPIC_PAGE[sug.topic];
    details[id] = (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href={sug.actionHref} className={`text-sm ${LINK}`}>
          {sug.actionLabel} ›
        </Link>
        {page && page !== sug.actionHref && <PageLink href={page} />}
      </div>
    );
    more[id] = <p>{sug.why}</p>;
  }
  const hasKind = (kind: string) => book.debts.some((d) => d.kind === kind);
  for (const d of [...accounts, ...plans]) {
    details[itemId("debts", d.key)] = (
      <ul aria-label={d.inNetWorth ? "Loans and cards" : "Buy now, pay later plans"}>
        <DebtCard debt={d} open={openKey === d.key} error={error} />
      </ul>
    );
    const page =
      d.kind === "mortgage"
        ? "/loans/mortgage"
        : d.kind === "student"
          ? "/loans/student"
          : d.kind === "auto"
            ? "/loans/auto"
            : d.kind === "card"
              ? "/loans/interest"
              : null;
    if (page) more[itemId("debts", d.key)] = <PageLink href={page} />;
  }
  details[itemId("debts", "installments")] = (
    <div className="flex flex-col gap-1 text-sm">
      <ul aria-label="Installments coming" className="list-disc pl-5">
        {bnpl.installments.slice(0, 8).map((i) => (
          <li key={`${i.planKey}${i.date}`}>
            {dayLabel(i.date)}: {formatCents(i.cents)} to {i.name}
          </li>
        ))}
      </ul>
      <p className="text-zinc-600 dark:text-zinc-400">
        Any your forecast doesn&apos;t count yet are taken off your safe to spend.
      </p>
    </div>
  );
  details[itemId("cheaper", "checked")] = (
    <div className="flex flex-col gap-1">
      <PageLink href="/loans/refinance" />
      {hasKind("student") && <PageLink href="/loans/student" />}
      {hasKind("mortgage") && <PageLink href="/loans/mortgage" />}
      {hasKind("auto") && <PageLink href="/loans/auto" />}
    </div>
  );
  // Each cheaper-loan suggestion also opens the other pages for the loans the person has.
  for (const topic of ["refinance", "student_repayment", "student_forgiveness", "pmi_removal"]) {
    const id = itemId("cheaper", topic);
    if (!details[id]) continue;
    details[id] = (
      <div className="flex flex-col gap-1">
        {details[id]}
        {topic !== "refinance" && <PageLink href="/loans/refinance" />}
        {hasKind("student") && !topic.startsWith("student") && <PageLink href="/loans/student" />}
        {hasKind("mortgage") && topic !== "pmi_removal" && <PageLink href="/loans/mortgage" />}
      </div>
    );
  }
  details[itemId("payoff", "plan")] = <PageLink href="/debt" />;
  details[itemId("credit", "score")] = <PageLink href="/loans/credit" />;
  details[itemId("credit", "use")] = <PageLink href="/loans/credit" />;
  details[itemId("credit", "goal")] = <PageLink href="/loans/goal" />;
  details[itemId("borrow", "power")] = <PageLink href="/loans/borrow" />;
  details[itemId("borrow", "home")] = <PageLink href="/loans/home" />;
  details[itemId("borrow", "car")] = <PageLink href="/loans/car" />;
  details[itemId("borrow", "cards")] = <PageLink href="/loans/cards" />;
  details[itemId("reviews", "debt")] = <PageLink href="/loans/review" />;

  // Opened from a debt's "Add what your bank doesn't report" (?terms=) or a deep link.
  const focus = one("focus") || (openKey ? itemId("debts", openKey) : "");

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="loans_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Every debt</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {book.debts.length === 0
            ? "No loans, cards or plans yet."
            : `You owe ${formatCents(book.totalOwedCents)}, ${formatCents(book.monthlyCents)} due each month. Open a branch to see more.`}
        </p>
        <nav aria-label="Loans pages" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/debt" className={LINK}>
            Payoff plan
          </Link>
          <Link href="/loans/refinance" className={LINK}>
            Refinance
          </Link>
          <Link href="/loans/credit" className={LINK}>
            Credit score
          </Link>
          <Link href="/loans/borrow" className={LINK}>
            What you could borrow
          </Link>
        </nav>
      </div>

      {saved && (
        <p role="status" className="border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          {saved}
        </p>
      )}

      {book.debts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          When you{" "}
          <Link href="/connect" className={LINK}>
            link a bank
          </Link>{" "}
          that reports them, they show here with their rates and due dates.
        </p>
      ) : (
        <AreaPage
          tree={area.tree}
          label="Loans & credit"
          chips={area.chips}
          summaries={area.summaries}
          details={details}
          more={more}
          focus={focus || undefined}
        />
      )}

      {/* Below the tree: nothing open by default (docs/design/area-pages.md). */}
      <div className="flex flex-col gap-2">
        {plans.length > 0 && (
          <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <summary className={`cursor-pointer text-sm ${LINK}`}>About buy now, pay later</summary>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Found from your payments to Affirm, Klarna and Afterpay. They aren&apos;t bank
              accounts, so net worth doesn&apos;t count them
              {book.bnplUnknown > 0 ? ` (${book.bnplUnknown} without a balance yet)` : ""}.
            </p>
          </details>
        )}
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>How Jane gets your rates</summary>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Rates, payments and dates come from what your bank reports, or what you type for what it
            leaves out. Every rate says where it came from, and Jane never guesses one. Your
            statements are the source of truth.
          </p>
        </details>
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>Own a home or a car?</summary>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <AssetPrompts prompts={prompts} />
            <p className="text-zinc-600 dark:text-zinc-400">
              <Link href="/things" className={LINK}>
                Things you own
              </Link>{" "}
              shows what you own of it, from the values you give.
            </p>
          </div>
        </details>
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>All loans and credit pages</summary>
          <ul aria-label="All loans and credit pages" className="mt-2 flex flex-col gap-1 text-sm">
            {PAGES.map((p) => (
              <li key={p.href}>
                {p.what}:{" "}
                <Link href={p.href} className={LINK}>
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </div>
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
