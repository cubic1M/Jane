import { dayLabel } from "@/lib/day-label";
import { staleStatementsEnd } from "@/lib/report-state";
import Link from "next/link";
import { ShownLink } from "@/components/shown-link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { TryFeedbackBox } from "@/components/try-feedback-box";
import { isTrialUser } from "@/lib/trial-ids";
import { BankStatusNotice } from "@/components/bank-status-notice";
import { BooksNotice } from "@/components/books-notice";
import { GiantTree } from "@/components/hub/giant-tree";
import { JaneFound } from "@/components/hub/jane-found";
import { loadAreaTrees } from "@/lib/hub/area-trees";
import { readingTiles, withAreaStatus } from "@/lib/hub/area-status";
import { isFirstDetectionComplete } from "@/detection/engine";
import { adviceMode } from "@/lib/advice-mode";
import { scopedFor } from "@/lib/db-scoped";
import { buildFeatureMap, sampleExamples } from "@/lib/feature-map";
import { openBooks } from "@/lib/books";
import type { HomeSummary } from "@/lib/home";
import { loadHubAreas, loadHubTop } from "@/lib/hub/load";
import { netWorthEvents } from "@/lib/hub/net-worth-events";
import { Blinded } from "@/components/hub/blinded";
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { NetWorthChart } from "@/components/hub/net-worth-chart";
import { tilesView } from "@/lib/hub/view";
import { requireUser } from "@/lib/session";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { loadBankNotices } from "@/lib/plaid/bank-status";
import { SuggestionCards } from "../chat/suggestion-cards";
import { LoadingBar } from "@/components/loading-bar";
import { loansNotCounted, NO_BANK_SEEN, notCounting } from "@/insights/net-worth";
import {
  accountsWithoutBalance,
  loansSeenWithoutBalance,
  onlyDebtsSeen,
} from "@/lib/net-worth-history";

// Home, the hub (docs/design/home-hub.md; it was Today, spec step 79). Redesigned 11-12 to the
// founder's loop ("Jane is supposed to watch your finances 24/7, proactively search for
// opportunities where you can save money, and then find you the solution and prefill the step"):
// where you stand (net worth), what Jane found with a yes or not now for each, and what needs
// you. Everything else is one tap away: the area tabs, "Everything Jane watches" folded at the
// end, and Safe to spend, the next 30 days and last month's close on Spending & bills.

function NeedsYou({
  waiting,
  unreadAlerts,
}: {
  waiting: HomeSummary["waitingOnYou"];
  unreadAlerts: number;
}) {
  if (waiting.length === 0 && unreadAlerts === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-amber-50 p-4 dark:bg-amber-950">
      <h2 className="font-semibold">Needs you</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {waiting.map((a) => (
          <li key={a.id}>
            <strong>{a.title}:</strong> {a.todo ?? "see your actions."}{" "}
            <ShownLink href="/actions" className="font-medium text-emerald-800 hover:underline">
              Open
            </ShownLink>
          </li>
        ))}
        {unreadAlerts > 0 && (
          <li>
            <Link href="/jane" className="font-medium text-emerald-800 hover:underline">
              {unreadAlerts === 1 ? "1 new alert" : `${unreadAlerts} new alerts`}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

// What the giant tree reads, started with the page so it doesn't wait for anything else. Each
// area with a tree page shows that tree's branches, from the same loaders its page uses (a
// loader that fails leaves its area showing what Jane looks for there).
const loadTreeData = (userId: string) =>
  Promise.all([
    scopedFor(userId).suggestions.findMany({ select: { key: true } }),
    adviceMode(userId),
    loadAreaTrees(userId),
  ]);
type TreeData = Awaited<ReturnType<typeof loadTreeData>>;

// "What Jane does" (src/components/hub/giant-tree.tsx): Home's one set of area tiles, each with
// its status (from its own tree) and its figure, opening into its branches and features.
async function AreasTree({
  userId,
  home,
  treeData,
}: {
  userId: string;
  home: HomeSummary;
  treeData: Promise<TreeData>;
}) {
  const [[reached, advice, areaTrees], areas, looked] = await Promise.all([
    treeData,
    loadHubAreas(userId, {
      budgetsOver: home.budgetsOver.length,
      safeShort: (home.safeToSpend?.safeCents ?? 0) < 0,
    }),
    isFirstDetectionComplete(userId),
  ]);
  const maps = buildFeatureMap({
    examples: sampleExamples(),
    reached: new Set(reached.map((r) => r.key)),
    advice,
  });
  // Before the first scan has looked, no area is "Good" yet.
  if (!looked) {
    return <GiantTree maps={maps} tiles={readingTiles(tilesView(areas))} />;
  }
  return (
    <GiantTree
      maps={maps}
      areaTrees={areaTrees}
      tiles={withAreaStatus(tilesView(areas), areaTrees)}
    />
  );
}

// The net worth chart: every day since the first day with Jane, ending at the hub's own figure,
// and what moved it, from its first day.
async function NetWorthHero({ userId, todayCents }: { userId: string; todayCents: number }) {
  const [line, missing, loans, onlyDebts] = await Promise.all([
    netWorthHistory(userId, todayCents),
    accountsWithoutBalance(userId),
    loansSeenWithoutBalance(userId),
    onlyDebtsSeen(userId),
  ]);
  const events = line[0] ? await netWorthEvents(userId, line[0].date, todayCents) : [];
  // Never a number that silently leaves a debt out (an uploaded card with no balance yet).
  return (
    <NetWorthChart
      points={line}
      events={events}
      notCounting={notCounting(missing)?.sentence}
      loansLeft={
        [onlyDebts ? NO_BANK_SEEN : null, loansNotCounted(loans)].filter(Boolean).join(" ") || null
      }
    />
  );
}

// No balance known yet (statements without a balance column, nothing owned entered): not "$0"
// (overnight upload QA: "Net worth $0 · Your line starts today" for a Wells Fargo upload).
function NetWorthUnknown() {
  return (
    <section
      aria-label="Net worth"
      className="flex flex-col gap-2 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Net worth</p>
      <p className="text-3xl font-semibold tracking-tight">Not known yet</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Your files don&apos;t include a balance.{" "}
        <Link href="/import" className="font-medium underline">
          Add one on the import page
        </Link>{" "}
        and your line starts there.
      </p>
    </section>
  );
}

// While the line loads: the hidden figure at the chart's size, so nothing moves.
function NetWorthLoading() {
  return (
    <section
      aria-label="Net worth"
      aria-busy="true"
      className="flex flex-col gap-2 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Net worth</p>
      <p className="text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
        <Blinded />
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Drawing your line…</p>
      <div aria-hidden="true" className="h-[190px] sm:h-[260px]" />
    </section>
  );
}

async function HubContent({ searchParams }: { searchParams: PageProps<"/home">["searchParams"] }) {
  await connection();
  const user = await requireUser();
  // Everything the hub reads starts at once (speed pass, 2026-10-24): the tree's data too, which
  // the tree's Suspense picks up when it's ready.
  const treeData = loadTreeData(user.id);
  // Read later by the tree; a failure shows there, not as an unhandled rejection here.
  treeData.catch(() => {});
  const [top, books, suggestions, banks, read, looked] = await Promise.all([
    loadHubTop(user.id),
    openBooks(user.id),
    // Jane's cards, as the chat shows them (on a computer the dock above the chat has them).
    loadPopupStack(user.id),
    loadBankNotices(user.id),
    scopedFor(user.id).transactions.aggregate({ _max: { date: true } }),
    isFirstDetectionComplete(user.id),
  ]);
  if (!top) redirect("/connect");
  // Too old to say what's current: say so, with the way to fix it.
  const oldStatements = staleStatementsEnd(read._max.date, new Date());
  const { home } = top;
  const todayCents = top.hero.netWorth?.todayCents ?? 0;

  return (
    <>
      {/* Opening Home sets off the practice scan and the checklist's progress. */}
      <AppHeader user={user} opened={{ page: "home" }} />
      <BankStatusNotice notices={banks} />
      <BooksNotice books={books} skipItems={banks.map((b) => b.itemId)} />
      {oldStatements && (
        <p className="border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          Your statements end {dayLabel(oldStatements, { year: true })}.{" "}
          <Link href="/import" className="font-medium underline">
            Upload newer statements
          </Link>
        </p>
      )}
      <h1 className="sr-only">Home</h1>

      {/* Where you stand. */}
      {top.hero.netWorth?.known === false ? (
        <NetWorthUnknown />
      ) : (
        // Its own boundary: the history and what moved it are read after the rest, so the page
        // paints without waiting for them (speed pass).
        <Suspense fallback={<NetWorthLoading />}>
          <NetWorthHero userId={user.id} todayCents={todayCents} />
        </Suspense>
      )}

      {/* What Jane found, each a yes or not now. On a computer the cards are in the dock beside
          the chat (CSS hides this copy, src/app/globals.css [data-home-cards]). */}
      <JaneFound items={home.plan.items} looking={!looked}>
        <div data-home-cards="">
          <SuggestionCards messages={suggestions} docked inPage />
        </div>
      </JaneFound>

      <NeedsYou waiting={home.waitingOnYou} unreadAlerts={home.unreadAlerts} />

      {isTrialUser(user.id) && (
        <TryFeedbackBox
          from="/home"
          state={String((await searchParams).feedback ?? "") || undefined}
        />
      )}

      {/* Everything else Jane watches, one tap away (home redesign 11-12: the six areas' tree
          was the page's biggest set of things to click). Safe to spend, the next 30 days and
          last month's close are on Spending & bills; the area tabs above open each area. */}
      <details data-home-more="" className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <summary className="cursor-pointer font-mono text-sm font-medium">
          Everything Jane watches
        </summary>
        <div className="mt-3">
          <Suspense fallback={<LoadingBar label="Loading what Jane does" />}>
            <AreasTree userId={user.id} home={home} treeData={treeData} />
          </Suspense>
        </div>
      </details>
    </>
  );
}

export default function HomePage({ searchParams }: PageProps<"/home">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<PageLoading label="Loading your hub" />}>
        <HubContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
