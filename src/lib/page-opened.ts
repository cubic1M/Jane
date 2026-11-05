import { firstWeekChecklist, recordChecklistProgress } from "@/lib/checklist";
import { refreshEventsIfStale } from "@/lib/events/refresh";
import { runEventsIfStale } from "@/lib/events/run";
import { runPaperIfStale } from "@/lib/paper/account";
import { markPlanShown } from "@/lib/plan";
import { scanOnOpenQuietly } from "@/lib/practice/scan";

// What a person opening a page sets off. A page's render can't do this any more: it also runs when
// the page loads quietly ahead of time (src/lib/page-cache.ts), when nobody has seen it, and not at
// all when the page comes back from memory. So the browser says when one is really on screen
// (AppHeader's opened, src/lib/page-cache.ts, /api/opened).

export type OpenedPage = "home" | "investments" | "plan";

export async function pageOpened(
  userId: string,
  page: OpenedPage,
  findingIds: readonly string[] = [],
): Promise<void> {
  if (page === "plan") {
    // Seeing the plan counts as seeing each card in it.
    await markPlanShown(userId, [...findingIds]);
    return;
  }
  // Constant search (Phase AW): a cheap practice scan. Home is where people land now.
  await scanOnOpenQuietly(userId);
  if (page === "home") {
    const checklist = await firstWeekChecklist(userId);
    if (checklist?.newlyDone.length) await recordChecklistProgress(userId, checklist);
    return;
  }
  // The paper account valued at the latest closes, when its last run is stale. Then the events:
  // read again when the last check is over an hour old (one shared refresh, locked), then the
  // overlay on top of the paper account, when its run was missed or there's news.
  const events = async () => {
    const refreshed = await refreshEventsIfStale();
    await runEventsIfStale(userId, { news: Boolean(refreshed?.ran && refreshed.report.stored) });
  };
  // Apart: one failing never stops the other.
  const [paper, news] = await Promise.allSettled([runPaperIfStale(userId), events()]);
  for (const result of [paper, news]) if (result.status === "rejected") throw result.reason;
}
