import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { BORROW_LABELS, BORROW_SOURCES } from "@/config/borrowing-power";
import { formatRate } from "@/insights/loans";
import { ensureBorrowingChecked, loadBorrowingPower } from "@/lib/borrowing-power";
import { loadHomeBuying } from "@/lib/home-buying";
import { homeMeasureOf, homeVsBorrow, mortgageOf } from "@/planning/home-vs-borrow";
import { dayLabel } from "@/lib/day-label";
import { scoreLine } from "@/lib/jane-agent/borrowing-power-replies";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { checkAgainAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// What you could borrow (spec step 250): a mortgage, a car loan, a personal loan and a card, each
// with the likely amount and rate from soft checks, the day it was checked, and what would
// improve it. Soft checks never touch the score; nothing is applied for from here.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON =
  "h-11 rounded-full border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const CARD = "flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function BorrowContent({ searchParams }: Pick<PageProps<"/loans/borrow">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  await ensureBorrowingChecked(user.id);
  const [d, home] = await Promise.all([loadBorrowingPower(user.id), loadHomeBuying(user.id)]);
  const both = homeVsBorrow(homeMeasureOf(home), mortgageOf(d.figures));
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">What you could borrow</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The likely amount and rate for each kind of loan, from soft checks that don&apos;t touch
          your score, and what would make each better.
        </p>
      </div>
      {raw.checked && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          Checked again just now.
        </p>
      )}
      {!d.available || !d.checkedOn ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          There&apos;s no lending partner for your accounts yet, so there&apos;s nothing to check.
        </p>
      ) : (
        <>
          <DemoAdviceLabel />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Checked {dayLabel(d.checkedOn, { year: true })}. {scoreLine(d)}
          </p>
          {d.changes.length > 0 && (
            <ul
              aria-label="Since the last check"
              className="text-sm text-emerald-800 dark:text-emerald-200"
            >
              {d.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <ul aria-label="What you could borrow" className="flex flex-col gap-3">
            {d.figures.map((f) => (
              <li key={f.product} className={CARD}>
                <h2 className="font-medium">{BORROW_LABELS[f.product]}</h2>
                {!f.available ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Not yet. {f.why}</p>
                ) : f.product === "card" ? (
                  <p className="text-sm">
                    About {formatRate(f.aprBps!)} after any intro offer, with a limit around{" "}
                    {formatCents(f.limitCents)} (a guess from your income; the issuer sets it).
                  </p>
                ) : (
                  <p className="text-sm">
                    Up to about <strong>{formatCents(f.amountCents)}</strong> at about{" "}
                    {formatRate(f.aprBps!)} over {Math.round(f.termMonths / 12)} years with{" "}
                    {f.lender}: {formatCents(f.paymentCents)} a month
                    {f.feeCents > 0 ? `, ${formatCents(f.feeCents)} in fees` : ""}.
                  </p>
                )}
                <p className="text-xs text-zinc-500">
                  Checked {dayLabel(d.checkedOn!, { year: true })}
                </p>
                {f.improve.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                    {f.improve.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {both && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {both}{" "}
              <Link href="/loans/home" className={LINK}>
                Buying a home
              </Link>
            </p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            These are estimates from the lender stand-in, not offers. To compare options for a loan
            you want now, see{" "}
            <Link href="/loans/refinance" className={LINK}>
              your loan offers
            </Link>
            ; applying is a separate step, and only on your tap.
          </p>
          <form action={checkAgainAction}>
            <SubmitButton className={BUTTON}>Check again</SubmitButton>
          </form>
        </>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {BORROW_SOURCES.map((s) => (
          <li key={s.url}>
            <a href={s.url} className={LINK}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function BorrowPage(props: PageProps<"/loans/borrow">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <BorrowContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
