import Link from "next/link";
import { ShownLink } from "@/components/shown-link";
import { Suspense } from "react";
import { AccountList } from "@/components/account-list";
import { AppHeader, PageLoading } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { isFirstDetectionComplete, moneyFoundParts, yearlyFoundCents } from "@/detection/engine";
import { listAccountSummaries } from "@/lib/accounts";
import { CARD_SELECT } from "@/lib/cards";
import { scopedDb } from "@/lib/db-scoped";
import { explanationFor } from "@/lib/card-text";
import { requireUser } from "@/lib/session";
import { savingsLine } from "@/lib/savings-text";
import { LoadingBar } from "@/components/loading-bar";

// How many findings the report opens with; the rest are behind "more" (founder: "show what
// matters, hide the rest").
const TOP = 3;
const MORE = "cursor-pointer text-sm font-medium underline underline-offset-2 hover:no-underline";
import { scanInProgress } from "@/lib/scan";
import { RefreshWhenScanned } from "./refresh-when-scanned";
import { Checkup } from "./checkup";
import { loadCheckup } from "@/lib/checkup";
import {
  findingSure,
  foundHeadline,
  foundLine,
  reportOrder,
  reportState,
  shortUploadDays,
  staleStatementsEnd,
} from "./state";
import { isoDay } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { monthsCovered, statementsEnd } from "@/profile/build";
import { ShareButton } from "./share-button";
import { cardFor } from "@/lib/share-card";
import { isTrialUser } from "@/lib/trial-ids";
import { SUGGESTED_UPLOAD_MONTHS } from "@/config/import";

// Shown while the first scan runs, so the person knows what we look at. Once it's done, the
// checkup (./checkup.tsx) says what each check found.
const WHAT_WE_CHECK = [
  "Subscriptions you may not use",
  "Paying for two services that do the same thing",
  "Bills that went up",
  "Bank and card fees",
  "Cash earning little interest",
  "Insurance you could reshop",
  "Credit card interest",
  "Bills that could take your balance too low",
  "Double charges, charges after you cancelled, and trials that became full charges",
  "Phone and internet bills above the typical price",
];

async function ReportContent() {
  const user = await requireUser();
  const db = await scopedDb();
  const [accounts, findings, parts, firstDetectionDone, scanRunning, uploaded, read, sures] =
    await Promise.all([
      listAccountSummaries(db),
      db.findings.findMany({
        where: { status: { in: ["new", "shown"] } },
        select: { ...CARD_SELECT, confidence: true },
      }),
      moneyFoundParts(user.id),
      isFirstDetectionComplete(user.id),
      scanInProgress(user.id),
      // What uploaded statements cover, to ask for more months when it's short.
      db.transactions.aggregate({
        where: { source: "csv" },
        _min: { date: true },
        _max: { date: true },
      }),
      // How much history Jane has read, and the scan's own confidence on each topic, for each
      // finding's "% sure" (the newest first).
      db.transactions.aggregate({ _min: { date: true }, _max: { date: true } }),
      db.suggestions.findMany({
        select: { topic: true, confidencePercent: true, confidenceReason: true },
        orderBy: { lastSeenAt: "desc" },
      }),
    ]);
  const found = parts.cents;
  // The profile's own count (src/profile/build.ts), so every "N months of data" agrees.
  // To the last day the statements reach, never past today, as the profile counts.
  const months =
    read._min.date && read._max.date
      ? monthsCovered(
          isoDay(read._min.date),
          statementsEnd(isoDay(read._max.date), isoDay(new Date())),
        )
      : 0;
  const uploadDays = shortUploadDays(uploaded._min.date, uploaded._max.date);
  const oldStatements = staleStatementsEnd(read._max.date, new Date());
  const transactions = accounts.reduce((sum, a) => sum + a.transactionCount, 0);
  const state = reportState({
    transactions,
    findings: findings.length,
    firstDetectionDone,
    scanRunning,
  });
  // Every check's result, once Jane has read everything (never while it's still reading).
  const checks =
    state === "nothing" || state === "found"
      ? await loadCheckup(
          user.id,
          findings.map((f) => f.type),
        )
      : [];
  // The time-sensitive first, then what each is likely to be worth (src/app/report/state.ts).
  const ordered = reportOrder(findings);
  // The shareable result card (src/lib/share-card.ts); sample data never shares.
  const card = isTrialUser(user.id)
    ? null
    : cardFor({ foundCents: yearlyFoundCents(parts), checks: checks.length });
  const share = card && <ShareButton card={card} />;
  const top = ordered.slice(0, TOP);
  const rest = ordered.slice(TOP);
  const row = (finding: (typeof findings)[number]) => {
    const text = explanationFor(finding);
    const sure = findingSure(
      finding,
      sures,
      months,
      findings.filter((f) => f.type === finding.type).length,
    );
    return (
      <li key={finding.id}>
        <Link
          href={`/report/${finding.id}`}
          className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          <span className="flex flex-col gap-1">
            <span className="font-semibold">{text.title}</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {savingsLine(finding.type, finding.annualSavingsCents, finding.evidence)}
            </span>
            <span data-finding-sure="" className="text-xs text-zinc-500">
              {sure.percent}% sure: {sure.reason}
            </span>
          </span>
          <span aria-hidden className="text-zinc-400">
            ›
          </span>
        </Link>
      </li>
    );
  };
  // While the first scan runs, what's found so far, in the same order.
  const list = <ul className="flex flex-col gap-3">{ordered.map(row)}</ul>;

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="report_viewed" />

      {state === "scanning" ? (
        <section className="flex flex-col gap-3" data-report-scanning="">
          <RefreshWhenScanned />
          <h1 className="text-3xl font-semibold tracking-tight">Still reading your accounts</h1>
          <LoadingBar label="Reading your transactions" />
          <p className="text-zinc-600 dark:text-zinc-400">
            {transactions > 0
              ? `Jane has read ${transactions} transactions so far. What it finds shows here as it goes.`
              : "Jane is reading your accounts. What it finds shows here as it goes."}
          </p>
          {findings.length > 0 && (
            <>
              <h2 className="text-xl font-semibold">Found so far</h2>
              {list}
            </>
          )}
          <h2 className="text-xl font-semibold">What Jane is checking</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {WHAT_WE_CHECK.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        </section>
      ) : state === "no_data" ? (
        <section className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Your money report</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            We haven&apos;t read any transactions yet. Upload your bank statements and Jane will
            look for money you&apos;re losing.
          </p>
          <Link href="/connect" className="font-medium text-emerald-700 hover:underline">
            Upload your statements
          </Link>
        </section>
      ) : state === "nothing" ? (
        <section className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Nothing to fix right now</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Jane read {transactions} transactions and ran {checks.length} checks. Tap one to see
            what it looked at.
          </p>
          {uploadDays !== null && <MoreMonths days={uploadDays} />}
          {oldStatements && <OldStatements day={oldStatements} />}
          <Checkup lines={checks} />
          {share}
          <ShownLink href="/actions" className="font-medium text-emerald-700 hover:underline">
            See what we&apos;re working on
          </ShownLink>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {found > 0
                ? foundHeadline(parts)
                : `We found ${findings.length} ${findings.length === 1 ? "thing" : "things"} to look at`}
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              {found > 0
                ? foundLine(
                    transactions,
                    findings.map((f) => f.type),
                  )
                : foundLine(transactions, [])}
            </p>
          </div>
          {uploadDays !== null && <MoreMonths days={uploadDays} />}
          {oldStatements && <OldStatements day={oldStatements} />}
          {/* What matters now (docs/design/area-pages.md): the three worth the most, open; the
              rest behind "more". */}
          <h2 className="text-xl font-semibold">What matters now</h2>
          <ul aria-label="What matters now" className="flex flex-col gap-3">
            {top.map(row)}
          </ul>
          {rest.length > 0 && (
            <details
              data-report-more=""
              className="border-t border-zinc-200 pt-3 dark:border-zinc-800"
            >
              <summary className={MORE}>{rest.length} more to look at</summary>
              <ul className="mt-3 flex flex-col gap-3">{rest.map(row)}</ul>
            </details>
          )}
          <Checkup lines={checks} />
          {share}
        </section>
      )}

      {accounts.length > 0 && (
        <details className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <summary className={MORE}>Accounts we read ({accounts.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            <AccountList accounts={accounts} />
            <Link href="/connect" className="font-medium text-emerald-700 hover:underline">
              Add or manage accounts
            </Link>
          </div>
        </details>
      )}
    </>
  );
}

// Uploaded statements cover under three months: monthly charges need more to show.
function MoreMonths({ days }: { days: number }) {
  return (
    <p
      data-more-months=""
      className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
    >
      Your statements cover {days} {days === 1 ? "day" : "days"}. Upload {SUGGESTED_UPLOAD_MONTHS}{" "}
      months and Jane can find more.{" "}
      <Link href="/import" className="font-medium underline">
        Upload more statements
      </Link>
    </p>
  );
}

// The newest statement line is weeks old: what Jane found describes then, not now.
function OldStatements({ day }: { day: string }) {
  return (
    <p
      data-old-statements=""
      className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
    >
      Your statements end {dayLabel(day, { year: true })}, so this is what was happening then.{" "}
      <Link href="/import" className="font-medium underline">
        Upload newer statements
      </Link>
    </p>
  );
}

export default function ReportPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <ReportContent />
      </Suspense>
    </main>
  );
}
