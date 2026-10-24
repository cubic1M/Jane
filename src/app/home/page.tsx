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
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { NetWorthChart } from "@/components/hub/net-worth-chart";
import { cashFlowView, heroView, tilesView } from "@/lib/hub/view";
import { scanOnOpenQuietly } from "@/lib/practice/scan";
import { requireUser } from "@/lib/session";
import { openPopupMessages, POPUP_LIMIT, stackedSuggestions } from "@/lib/jane-agent/messages";
import { isPopup, popupOrder } from "@/lib/jane-agent/popups";
import { timezoneOf } from "@/lib/jane-agent/open";
import { toView } from "@/lib/jane-agent/view";
import { SuggestionCards } from "../chat/suggestion-cards";
import { FirstWeekChecklist } from "./checklist";

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

async function HubContent() {
  await connection();
  const user = await requireUser();
  // Everything the hub reads starts at once (speed pass, 2026-10-24): the tree's data too, which
  // the tree's Suspense picks up when it's ready.
  const treeData = loadTreeData(user.id);
  // Read later by the tree; a failure shows there, not as an unhandled rejection here.
  treeData.catch(() => {});
  const [top, checklist, autopilot, books, stackedRows, zone, popupRows] = await Promise.all([
    loadHubTop(user.id),
    firstWeekChecklist(user.id),
    autopilotOf(user.id),
    openBooks(user.id),
    // The day's suggestions still waiting, as the chat shows them.
    stackedSuggestions(user.id),
    timezoneOf(user.id),
    // Anything else Jane brought up that waits on the person: a pop-up here too.
    openPopupMessages(user.id),
  ]);
  if (!top) redirect("/connect");
  const { home } = top;
  // Net worth every day since the first day with Jane, ending at the hub's own figure.
  const line = await netWorthHistory(user.id, top.hero.netWorth?.todayCents ?? 0);
  const now = new Date();
  const suggestions = [
    ...stackedRows.map((m) => toView(m, now, zone)),
    ...popupOrder(
      popupRows.map((m) => toView(m, now, zone)).filter((m) => isPopup(m) && !m.suggestion),
    ).slice(0, POPUP_LIMIT),
  ];
  // What moved it: the chart's events, from its first day.
  const events = line[0]
    ? await netWorthEvents(user.id, line[0].date, top.hero.netWorth?.todayCents ?? 0)
    : [];
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
        chart={<NetWorthChart points={line} events={events} />}
      />

      {/* Under the hero, before anything else: everything Jane does, as one tree. */}
      <Suspense fallback={<div className="h-[480px] sm:h-[600px]" aria-hidden="true" />}>
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
      <Suspense fallback={<p className="text-zinc-500">Loading your hub…</p>}>
        <HubContent />
      </Suspense>
    </main>
  );
}
