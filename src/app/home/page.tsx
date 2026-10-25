import Link from "next/link";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { AutopilotChooser } from "@/components/autopilot-chooser";
import { BooksNotice } from "@/components/books-notice";
import { CashFlowStrip } from "@/components/hub/cash-flow";
import { AreaTiles, AreaTilesLoading, HeroRow } from "@/components/hub/hub";
import { GiantTree } from "@/components/hub/giant-tree";
import { loadInsuranceArea } from "@/lib/area-pages/insurance-load";
import { loadInvestingArea } from "@/lib/area-pages/investing-load";
import { loadLoansArea } from "@/lib/area-pages/loans-load";
import { moneyTree } from "@/lib/area-pages/money";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { loadPlansArea } from "@/lib/area-pages/plans-load";
import { loadTaxesArea } from "@/lib/area-pages/taxes-load";
import type { AreaTrees } from "@/lib/giant-tree";
import { adviceMode } from "@/lib/advice-mode";
import { scopedFor } from "@/lib/db-scoped";
import { buildFeatureMap, sampleExamples } from "@/lib/feature-map";
import { CASH_FLOW_DAYS } from "@/config/areas";
import { addDays } from "@/detection/units";
import { autopilotOf } from "@/lib/autopilot";
import { openBooks } from "@/lib/books";
import { firstWeekChecklist, recordChecklistProgress } from "@/lib/checklist";
import { dayLabel } from "@/lib/day-label";
import type { HomeSummary } from "@/lib/home";
import { loadHubAreas, loadHubTop } from "@/lib/hub/load";
import { netWorthEvents } from "@/lib/hub/net-worth-events";
import { formatCents } from "@/lib/money";
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { NetWorthChart } from "@/components/hub/net-worth-chart";
import { cashFlowView, heroView, tilesView } from "@/lib/hub/view";
import { scanOnOpenQuietly } from "@/lib/practice/scan";
import { requireUser } from "@/lib/session";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { SuggestionCards } from "../chat/suggestion-cards";
import { FirstWeekChecklist } from "./checklist";
import { LoadingBar } from "@/components/loading-bar";

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
            <Link href="/actions" className="font-medium text-emerald-800 hover:underline">
              Open
            </Link>
          </li>
        ))}
        {unreadAlerts > 0 && (
          <li>
            <Link href="/alerts" className="font-medium text-emerald-800 hover:underline">
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
const quietly = <T,>(load: Promise<T>) => load.catch(() => undefined);
const loadTreeData = (userId: string) =>
  Promise.all([
    scopedFor(userId).suggestions.findMany({ select: { key: true } }),
    adviceMode(userId),
    quietly(loadInsuranceArea(userId)),
    quietly(loadLoansArea(userId)),
    quietly(loadTaxesArea(userId)),
    quietly(loadPlansArea(userId)),
    quietly(loadInvestingArea(userId)),
    quietly(loadMoneyArea(userId).then(moneyTree)),
  ]);
type TreeData = Awaited<ReturnType<typeof loadTreeData>>;

async function Tiles({ userId, home }: { userId: string; home: HomeSummary }) {
  const areas = await loadHubAreas(userId, {
    budgetsOver: home.budgetsOver.length,
    safeShort: (home.safeToSpend?.safeCents ?? 0) < 0,
  });
  return <AreaTiles tiles={tilesView(areas)} />;
}

// The giant "What Jane does" tree (src/components/hub/giant-tree.tsx): Jane, the six areas,
// their branches and features, all at once, from the same map as /home/map.
async function AreasTree({ treeData }: { treeData: Promise<TreeData> }) {
  const [reached, advice, insurance, loans, taxes, plans, investing, money] = await treeData;
  const areaTrees: AreaTrees = {
    insurance: insurance?.area,
    loans: loans?.area,
    taxes: taxes?.area,
    ahead: plans?.area,
    investments: investing?.area,
    money,
  };
  const maps = buildFeatureMap({
    examples: sampleExamples(),
    reached: new Set(reached.map((r) => r.key)),
    advice,
  });
  return <GiantTree maps={maps} areaTrees={areaTrees} />;
}

// The net worth chart: every day since the first day with Jane, ending at the hub's own figure,
// and what moved it, from its first day.
async function NetWorthHero({ userId, todayCents }: { userId: string; todayCents: number }) {
  const line = await netWorthHistory(userId, todayCents);
  const events = line[0] ? await netWorthEvents(userId, line[0].date, todayCents) : [];
  return <NetWorthChart points={line} events={events} />;
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
        {formatCents(todayCents).replace(/\.\d\d$/, "")}
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
  const [top, checklist, autopilot, books, suggestions] = await Promise.all([
    loadHubTop(user.id),
    firstWeekChecklist(user.id),
    autopilotOf(user.id),
    openBooks(user.id),
    // Jane's cards, as the chat shows them (on a computer the dock above the chat has them).
    loadPopupStack(user.id),
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
      <BooksNotice books={books} />
      <h1 className="sr-only">Home</h1>

      <HeroRow
        hero={heroView(top.hero)}
        planItems={home.plan.items}
        chart={
          // Its own boundary: the history and what moved it are read after the top row's net
          // worth, so the rest of the hub paints without waiting for them (speed pass).
          <Suspense fallback={<NetWorthLoading todayCents={todayCents} />}>
            <NetWorthHero userId={user.id} todayCents={todayCents} />
          </Suspense>
        }
      />

      {/* Under the hero, before anything else: everything Jane does, as one tree. */}
      <Suspense fallback={<LoadingBar label="Loading what Jane does" />}>
        <AreasTree treeData={treeData} />
      </Suspense>

      <CashFlowStrip
        view={cashFlowView(top.cashFlow)}
        endDate={addDays(top.cashFlow.asOf, CASH_FLOW_DAYS)}
      />

      <Suspense fallback={<AreaTilesLoading />}>
        <Tiles userId={user.id} home={home} />
      </Suspense>

      <NeedsYou waiting={home.waitingOnYou} unreadAlerts={home.unreadAlerts} />
      {autopilot === null && <AutopilotChooser compact />}
      {checklist && !checklist.complete && <FirstWeekChecklist items={checklist.items} />}

      <p className="text-xs text-zinc-500">
        {home.lastUpdated
          ? `Data last updated ${dayLabel(home.lastUpdated, { year: true })}.`
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
      <Suspense fallback={<LoadingBar label="Loading your hub" />}>
        <HubContent />
      </Suspense>
    </main>
  );
}
