import Link from "next/link";
import { ShownLink } from "@/components/shown-link";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { conciergeMode } from "@/lib/concierge-mode";
import { AppHeader, PageLoading } from "@/components/app-header";
import { AutopilotChooser } from "@/components/autopilot-chooser";
import { BankStatusNotice } from "@/components/bank-status-notice";
import { BooksNotice } from "@/components/books-notice";
import { CashFlowStrip } from "@/components/hub/cash-flow";
import { HeroRow } from "@/components/hub/hub";
import { GiantTree } from "@/components/hub/giant-tree";
import { loadAreaTrees } from "@/lib/hub/area-trees";
import { withAreaStatus } from "@/lib/hub/area-status";
import { adviceMode } from "@/lib/advice-mode";
import { scopedFor } from "@/lib/db-scoped";
import { buildFeatureMap, sampleExamples } from "@/lib/feature-map";
import { CASH_FLOW_DAYS } from "@/config/areas";
import { addDays } from "@/detection/units";
import { autopilotOf } from "@/lib/autopilot";
import { openBooks } from "@/lib/books";
import { firstWeekChecklist, recordChecklistProgress } from "@/lib/checklist";
import type { HomeSummary } from "@/lib/home";
import { loadHubAreas, loadHubTop } from "@/lib/hub/load";
import { netWorthEvents } from "@/lib/hub/net-worth-events";
import { formatWholeDollars } from "@/lib/money";
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { NetWorthChart } from "@/components/hub/net-worth-chart";
import { cashFlowView, heroView, tilesView } from "@/lib/hub/view";
import { scanOnOpenQuietly } from "@/lib/practice/scan";
import { requireUser } from "@/lib/session";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { loadBankNotices, updatedAgo } from "@/lib/plaid/bank-status";
import { SuggestionCards } from "../chat/suggestion-cards";
import { FirstWeekChecklist } from "./checklist";
import { LoadingBar } from "@/components/loading-bar";
import { notCounting } from "@/insights/net-worth";
import { accountsWithoutBalance } from "@/lib/net-worth-history";

// Home, the hub (docs/design/home-hub.md; it was Today, spec step 79): graphs first, few
// words. The hero row (safe to spend, net worth, saved), the next 30 days of bills and
// paydays, and a tile per area with its health, one number and a tiny chart. What needs the
// person shows only when there is something. The day's suggestions pop up at the bottom of the
// hub (the chat beside it leaves them out here). The chat is docked beside it (the side chat).

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
  const [[reached, advice, areaTrees], areas] = await Promise.all([
    treeData,
    loadHubAreas(userId, {
      budgetsOver: home.budgetsOver.length,
      safeShort: (home.safeToSpend?.safeCents ?? 0) < 0,
    }),
  ]);
  const maps = buildFeatureMap({
    examples: sampleExamples(),
    reached: new Set(reached.map((r) => r.key)),
    advice,
  });
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
  const [line, missing] = await Promise.all([
    netWorthHistory(userId, todayCents),
    accountsWithoutBalance(userId),
  ]);
  const events = line[0] ? await netWorthEvents(userId, line[0].date, todayCents) : [];
  // Never a number that silently leaves a debt out (an uploaded card with no balance yet).
  return (
    <NetWorthChart points={line} events={events} notCounting={notCounting(missing)?.sentence} />
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

// While the line loads: today's figure (already known) at the chart's size, so nothing moves.
function NetWorthLoading({ todayCents }: { todayCents: number }) {
  return (
    <section
      aria-label="Net worth"
      aria-busy="true"
      className="flex flex-col gap-2 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Net worth</p>
      <p className="text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
        {formatWholeDollars(todayCents)}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Drawing your line…</p>
      <div aria-hidden="true" className="h-[190px] sm:h-[260px]" />
    </section>
  );
}

async function HubContent() {
  await connection();
  const user = await requireUser();
  // Everything the hub reads starts at once (speed pass, 2026-10-24): the tree's data too, which
  // the tree's Suspense picks up when it's ready.
  const treeData = loadTreeData(user.id);
  // Read later by the tree; a failure shows there, not as an unhandled rejection here.
  treeData.catch(() => {});
  const [top, checklist, autopilot, books, suggestions, banks, concierge] = await Promise.all([
    loadHubTop(user.id),
    firstWeekChecklist(user.id),
    autopilotOf(user.id),
    openBooks(user.id),
    // Jane's cards, as the chat shows them (on a computer the dock above the chat has them).
    loadPopupStack(user.id),
    loadBankNotices(user.id),
    conciergeMode(user.id),
  ]);
  if (!top) redirect("/connect");
  const { home } = top;
  const todayCents = top.hero.netWorth?.todayCents ?? 0;
  if (checklist?.newlyDone.length) {
    after(() => recordChecklistProgress(user.id, checklist));
  }
  // Constant search (Phase AW): a cheap practice scan, after the page is sent. It ran when the
  // chat's own page opened; Home is where people land now.
  after(() => scanOnOpenQuietly(user.id));

  return (
    <>
      <AppHeader user={user} />
      <BankStatusNotice notices={banks} />
      <BooksNotice books={books} skipItems={banks.map((b) => b.itemId)} />
      <h1 className="sr-only">Home</h1>

      <HeroRow
        hero={heroView(top.hero)}
        planItems={home.plan.items}
        chart={
          top.hero.netWorth?.known === false ? (
            <NetWorthUnknown />
          ) : (
            // Its own boundary: the history and what moved it are read after the top row's net
            // worth, so the rest of the hub paints without waiting for them (speed pass).
            <Suspense fallback={<NetWorthLoading todayCents={todayCents} />}>
              <NetWorthHero userId={user.id} todayCents={todayCents} />
            </Suspense>
          )
        }
      />

      {/* Under the hero, before anything else: everything Jane does, as one tree. */}
      <Suspense fallback={<LoadingBar label="Loading what Jane does" />}>
        <AreasTree userId={user.id} home={home} treeData={treeData} />
      </Suspense>

      <CashFlowStrip
        view={cashFlowView(top.cashFlow)}
        endDate={addDays(top.cashFlow.asOf, CASH_FLOW_DAYS)}
      />

      {/* The monthly close: Jane closing last month's books (src/app/close). */}
      <Link
        href="/close"
        prefetch={false}
        data-home-close=""
        className="self-start font-mono text-sm font-medium underline-offset-2 hover:underline"
      >
        [CLOSE] Last month&apos;s close ›
      </Link>

      <NeedsYou waiting={home.waitingOnYou} unreadAlerts={home.unreadAlerts} />
      {/* Only where Jane can act on its own: the read-only beta's real accounts can't, so the
          question would promise what it won't do (as in the chat). */}
      {autopilot === null && concierge && <AutopilotChooser compact />}
      {checklist && !checklist.complete && <FirstWeekChecklist items={checklist.items} />}

      <p className="text-xs text-zinc-500">
        {home.lastUpdated
          ? `Data last updated ${updatedAgo(home.lastUpdated, new Date())}.`
          : "Waiting for your first update."}{" "}
        <Link href="/connect" className="hover:underline">
          Manage accounts
        </Link>
      </p>

      <SuggestionCards messages={suggestions} foldOnPhone />
    </>
  );
}

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<PageLoading label="Loading your hub" />}>
        <HubContent />
      </Suspense>
    </main>
  );
}
