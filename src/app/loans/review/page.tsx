import { dayLabel } from "@/lib/day-label";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { REVIEW_REASON_TEXT, type ReviewItemKey } from "@/config/debt-review";
import { DEBT_AUTOPILOT } from "@/config/debt";
import { ensureBorrowingChecked } from "@/lib/borrowing-power";
import { computeCreditMonthly, loadCreditMonthly } from "@/lib/credit-monthly";
import { ensureChecked } from "@/lib/refinance";
import { loadDebtReview } from "@/lib/debt-review";
import { requireUser } from "@/lib/session";

// The yearly debt review (spec step 230): everything about debts and credit in one pass, what
// Jane did by herself within the debt caps, and what waits for a tap (in the chat, where each
// has its button, or on the page it belongs to).

const LINK = "font-medium text-emerald-700 hover:underline";
const CARD = "flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const PAGE: Record<ReviewItemKey, { href: string; label: string }> = {
  statements: { href: "/loans/credit", label: "Your credit score" },
  promos: { href: "/loans/interest", label: "Card interest and promotions" },
  rates: { href: "/loans/interest", label: "Card interest and promotions" },
  home: { href: "/loans/equity", label: "Your home loan" },
  goals: { href: "/loans/goal", label: "Your credit plan" },
};
const STATUS = { done: "Done by Jane", tap: "Needs you", ok: "Fine" } as const;

async function ReviewContent() {
  const user = await requireUser();
  await connection();
  const [data, kept] = await Promise.all([loadDebtReview(user.id), loadCreditMonthly(user.id)]);
  // Before Jane's first monthly pass (her runs skip quiet hours), worked out now, read-only:
  // nothing is sent or applied for from here.
  if (!kept) {
    // The soft checks it reads, as the offers pages do on first open: they never touch the score.
    await Promise.all([ensureChecked(user.id), ensureBorrowingChecked(user.id)]);
  }
  const monthly = kept ?? (await computeCreditMonthly(user.id));
  // The lower card rate is one step in both lists (docs/feature-audit.md, cluster 14): shown
  // once, in the review when it's there.
  const rateShown = data.available && data.items.some((i) => i.key === "rates");
  const monthlyItems = rateShown
    ? monthly.items.filter((i) => i.key !== "card_rate")
    : monthly.items;
  const autopilot = DEBT_AUTOPILOT[data.level].find((s) => s.step === 230);
  const monthlyAutopilot = DEBT_AUTOPILOT[data.level].find((s) => s.step === 251);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your debt review</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Once a year, and after a raise, a new loan or a missed payment, Jane goes over your debts
          and credit in one pass.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          I don&apos;t see a debt with a balance, so there&apos;s nothing to review yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          {data.advice && <DemoAdviceLabel />}
          <p role="status">
            {data.review
              ? `${REVIEW_REASON_TEXT[data.review.reason]}. Last done ${dayLabel(data.review.on, { year: true })}.`
              : "Jane hasn't done a review yet."}
            {data.due ? ` One is due now: ${REVIEW_REASON_TEXT[data.due].toLowerCase()}.` : ""}
          </p>
          <ul aria-label="Review items" className="flex flex-col gap-3">
            {data.items.map((i) => (
              <li key={i.key} className={CARD}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">{i.title}</h2>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {STATUS[i.status]}
                  </span>
                </div>
                <p>{i.text}</p>
                <Link href={PAGE[i.key].href} className={`${LINK} text-sm`}>
                  {PAGE[i.key].label}
                </Link>
              </li>
            ))}
          </ul>
          {autopilot && (
            <p role="note" className="text-sm text-zinc-600 dark:text-zinc-400">
              At your level: {autopilot.does}
            </p>
          )}
        </>
      )}
      {/* Spec step 251: the monthly credit check-up, the last one Jane did. */}
      <section aria-label="This month's check-up" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">This month&apos;s check-up</h2>
        {!monthly.available ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No loan, card balance, rent or costly borrowing to check this month.
          </p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {monthly.checkedOn
                ? `Done ${dayLabel(monthly.checkedOn, { year: true })}.`
                : "Jane's monthly pass hasn't run yet; this is how things stand today."}
            </p>
            <ul aria-label="Check-up items" className="flex flex-col gap-3">
              {monthlyItems.map((i) => (
                <li key={i.key} className={CARD}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{i.title}</h3>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      {STATUS[i.status]}
                    </span>
                  </div>
                  <p>{i.text}</p>
                  {i.link && (
                    <Link href={i.link.href} className={`${LINK} text-sm`}>
                      {i.link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {monthlyAutopilot && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Every month, at your level: {monthlyAutopilot.does}
          </p>
        )}
      </section>
    </>
  );
}

export default function ReviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ReviewContent />
      </Suspense>
    </main>
  );
}
