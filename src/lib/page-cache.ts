import { forgetMemory, keepInMemory } from "@/lib/page-memory";
import type { OpenedPage } from "@/lib/page-opened";
import {
  PAGE_KEEP_SECONDS,
  PAGE_OLD_MS,
  POSTS_THAT_CHANGE_NOTHING,
  PRELOAD_MAX_PER_HOUR,
  PRELOAD_MIN_GAP_MS,
  PRELOAD_PAGES,
  PRELOAD_SLOW_CONNECTIONS,
  PRELOAD_START_MS,
  PRELOAD_STEP_MS,
  SIGNED_OUT_PAGES,
  STILL_HERE_EVERY_MS,
  STILL_LOADING_SELECTOR,
} from "@/config/page-cache";

// Moving between pages (founder: "cache the pages so you go to a page you returned it's already
// done loading ... the other background pages are loading secretly"). The router keeps pages in
// memory (staleTimes, next.config.ts); this file decides what goes in and when it all goes:
//
// - In: once a signed-in page has settled, a round loads the main pages one at a time.
// - Old: a page older than PAGE_OLD_MS shows at once, then refreshes quietly.
// - Changed: a post that may change data empties the memory and refreshes, in every tab.
// - Someone else: another person's page, signing out, a session ended elsewhere, or a page restored
//   by the browser empties it with a full page load. Money must never show to the next person on a
//   shared computer.
//
// Nothing leaves memory: no page is stored on the device (public/sw.js).

export type PageCacheRouter = {
  refresh(): void;
  prefetch(href: string, options: { kind: "full"; onInvalidate?: () => void }): void;
};

// What opening a page sets off, on the server (src/lib/page-opened.ts): not in the page's render,
// which also runs when it loads ahead of time and not at all when it comes back from memory.
export type Opened = { page: OpenedPage; findingIds?: string[] };

type Message = { type: "changed" } | { type: "owner"; owner: string } | { type: "gone" };

const CHANNEL = "jane:page-cache";
const ONE_HOUR_MS = 60 * 60_000;

// A post that may change what a page shows: everything but the reports listed in the config.
export function changesData(url: string, method: string, here: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  const target = new URL(url, here);
  if (target.origin !== new URL(here).origin) return false;
  return !POSTS_THAT_CHANGE_NOTHING.includes(target.pathname);
}

// Whether an action's reply already emptied everything. revalidatePath and a changed cookie do
// ("1"); refresh() ("2") keeps preloaded pages, and no header keeps everything.
export const actionEmptiedCache = (header: string | null) => header === "1";

type Connection = { saveData?: boolean; effectiveType?: string } | undefined;

export function connectionAllowsPreload(connection: Connection): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !PRELOAD_SLOW_CONNECTIONS.includes(connection.effectiveType ?? "");
}

// The pages a round asks for, from where the person is now.
export function pagesToPreload(here: string): string[] {
  return PRELOAD_PAGES.filter((page) => page !== here);
}

// When the next round may start: after `wanted`, at least the gap after the last, and inside the
// hour's allowance. `rounds` are the start times of past rounds.
export function nextRoundAt(rounds: readonly number[], wanted: number): number {
  const last = rounds.at(-1);
  let at = last === undefined ? wanted : Math.max(wanted, last + PRELOAD_MIN_GAP_MS);
  const lastHour = rounds.filter((t) => t > at - ONE_HOUR_MS);
  const oldest = lastHour[0];
  if (lastHour.length >= PRELOAD_MAX_PER_HOUR && oldest !== undefined) at = oldest + ONE_HOUR_MS;
  return at;
}

// The page's age, by the server's clock against this browser's. The first page in a window was
// made moments ago, whatever the clocks say, so the gap then is the difference between them.
let clockGap: number | null = null;
export function ageOf(renderedAt: number, now: number): number {
  clockGap ??= now - renderedAt;
  return now - renderedAt - clockGap;
}

const framed = () => window.self !== window.top;

let router: PageCacheRouter | null = null;
let channel: BroadcastChannel | null = null;
let started = false;
// Whose pages this window holds, once a signed-in page has said.
let owner: string | null = null;
let rounds: number[] = [];
let roundTimer: ReturnType<typeof setTimeout> | null = null;
let steps: ReturnType<typeof setTimeout>[] = [];
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
// What came up while this tab was out of sight, for when it's back.
let refreshOwed = false;
let roundOwed = false;

const keep = (path: string) => keepInMemory(path, PAGE_KEEP_SECONDS * 1000);
const here = () => window.location.pathname + window.location.search;

// A full page load is the one sure way to empty the router's memory.
function reload() {
  owner = null;
  window.location.reload();
}

let lastAsked = 0;

// Still this person? Only a clear no empties the memory: no network, or a server having trouble,
// says nothing about the session.
async function askStillHere() {
  const now = Date.now();
  if (!owner || framed() || now - lastAsked < STILL_HERE_EVERY_MS) return;
  lastAsked = now;
  const asked = owner;
  const response = await fetch("/api/still-here", { cache: "no-store" }).catch(() => null);
  if (!response || asked !== owner) return;
  if (response.status === 401) {
    leaving();
    return;
  }
  if (!response.ok) return;
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (body?.id !== undefined && body.id !== asked) leaving();
}

function tell(message: Message) {
  channel?.postMessage(message);
}

function emptied() {
  forgetMemory();
  for (const step of steps) clearTimeout(step);
  steps = [];
  keep(here());
}

function refreshNow() {
  refreshOwed = false;
  emptied();
  router?.refresh();
  scheduleRound();
}

function refreshSoon() {
  if (document.hidden) {
    refreshOwed = true;
    return;
  }
  if (refreshTimer) clearTimeout(refreshTimer);
  // Several posts in a row (a card's answer, then its follow-up) are one refresh.
  refreshTimer = setTimeout(refreshNow, 200);
}

function dataChanged(actionHeader: string | null) {
  tell({ type: "changed" });
  // The chat's frame keeps no pages of its own: the window around it refreshes. A signed-out page
  // has none either (a form on the landing page, say).
  if (framed() || !owner) return;
  if (actionEmptiedCache(actionHeader)) {
    emptied();
    scheduleRound();
    return;
  }
  refreshSoon();
}

function watchPosts() {
  const original = window.fetch;
  window.fetch = function watched(input: RequestInfo | URL, init?: RequestInit) {
    const result = original.call(window, input, init);
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (changesData(url, method, window.location.href)) {
      void result
        .then(async (response) => {
          if (!response.ok) return;
          // At the end of the reply: a chat answer does its work while it streams.
          await response
            .clone()
            .arrayBuffer()
            .catch(() => undefined);
          dataChanged(response.headers.get("x-action-revalidated"));
        })
        .catch(() => undefined);
    }
    return result;
  };
}

function runRound() {
  roundTimer = null;
  if (document.hidden) {
    roundOwed = true;
    return;
  }
  if (document.querySelector(STILL_LOADING_SELECTOR)) {
    roundTimer = setTimeout(runRound, 500);
    return;
  }
  const start = () => {
    rounds.push(Date.now());
    rounds = rounds.slice(-PRELOAD_MAX_PER_HOUR);
    pagesToPreload(window.location.pathname).forEach((page, i) => {
      const step = setTimeout(() => {
        // Whatever empties the router's memory, a later round fills it again.
        router?.prefetch(page, { kind: "full", onInvalidate: scheduleRound });
        keep(page);
      }, i * PRELOAD_STEP_MS);
      steps.push(step);
    });
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 2_000 });
  else setTimeout(start, 200);
}

export function scheduleRound() {
  if (roundTimer || !owner || framed()) return;
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (!connectionAllowsPreload(connection)) return;
  const at = nextRoundAt(rounds, Date.now() + PRELOAD_START_MS);
  roundTimer = setTimeout(runRound, at - Date.now());
}

// Once per window, from the root layout: the chat's frame gets one too, which only tells.
export function startPageCache(next: PageCacheRouter) {
  router = next;
  if (started) return;
  started = true;
  watchPosts();
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<Message>) => {
      if (!owner) return;
      if (data.type === "gone" || (data.type === "owner" && data.owner !== owner)) reload();
      else if (data.type === "changed" && !framed()) refreshSoon();
    };
    // A page that came up before this started.
    if (owner) tell({ type: "owner", owner });
  }
  // Back to this page from the browser's own memory of it: what it held, figures shown included,
  // comes back with it. Never remembered, so it loads again.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && owner) reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    void askStillHere();
    if (refreshOwed) refreshNow();
    else if (roundOwed) scheduleRound();
    roundOwed = false;
  });
}

// A signed-in page is on screen (src/components/page-cache.tsx).
export function pageShown(userId: string, renderedAt: number, opened?: Opened) {
  if (owner && owner !== userId) {
    reload();
    return;
  }
  if (!owner) {
    owner = userId;
    tell({ type: "owner", owner: userId });
  }
  keep(here());
  void askStillHere();
  if (opened) {
    fetch("/api/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opened),
      keepalive: true,
    }).catch(() => {});
  }
  const now = Date.now();
  if (ageOf(renderedAt, now) > PAGE_OLD_MS) refreshNow();
  // The first time, and when what the last round loaded has run out.
  else if ((rounds.at(-1) ?? 0) + PAGE_KEEP_SECONDS * 1000 < now) scheduleRound();
}

// Arriving at a signed-out page from another page, without a page load: they signed out, deleted
// their data or their session ended. Whatever this window holds goes.
let lastPath: string | null = null;
export function pageChanged(pathname: string) {
  const out = (path: string) => SIGNED_OUT_PAGES.includes(path);
  if (lastPath !== null && lastPath !== pathname && out(pathname) && !out(lastPath)) leaving();
  lastPath = pathname;
}

// Signing out, deleting, or Start over: every window empties, this one too. Called once the session
// is gone, so a window that loads again finds nobody signed in.
export function leaving() {
  leavingOtherTabs();
  reload();
}

export function leavingOtherTabs() {
  tell({ type: "gone" });
}

// Tests only: a new window.
export function resetPageCacheForTests() {
  router = null;
  channel = null;
  started = false;
  owner = null;
  lastPath = null;
  lastAsked = 0;
  clockGap = null;
  forgetMemory();
  rounds = [];
  roundTimer = null;
  steps = [];
  refreshTimer = null;
  refreshOwed = false;
  roundOwed = false;
}
