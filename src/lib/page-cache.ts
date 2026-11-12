import { TRIAL_ID_PREFIX } from "@/config/trial";
import { forgetMemory, isInMemory, keepInMemory } from "@/lib/page-memory";
import type { OpenedPage } from "@/lib/page-opened";
import {
  NO_ROUND_FROM,
  PAGE_KEEP_SECONDS,
  PAGE_OLD_MS,
  POSTS_THAT_CHANGE_LITTLE,
  POSTS_THAT_CHANGE_NOTHING,
  PRELOAD_MAX_PER_HOUR,
  PRELOAD_MIN_GAP_MS,
  PRELOAD_PAGES,
  PRELOAD_SLOW_CONNECTIONS,
  PRELOAD_START_MS,
  PRELOAD_STEP_MS,
  REFILL_AFTER_MS,
  REFILL_PAGES,
  SIGNED_OUT_PAGES,
  STILL_HERE_EVERY_MS,
  STILL_LOADING_SELECTOR,
} from "@/config/page-cache";

// Moving between pages (founder: "cache the pages so you go to a page you returned it's already
// done loading ... the other background pages are loading secretly"). The router keeps pages in
// memory (staleTimes, next.config.ts); this file decides what goes in and when it all goes:
//
// - In: once a signed-in page has settled, a round loads the main pages one at a time.
// - Old: a page older than PAGE_OLD_MS shows at once, then refreshes quietly, in place: the others
//   stay in memory.
// - Changed: a post that may change data empties the memory and refreshes, in every tab, and a round
//   loads the pages again soon after. A chat message only marks them: each refreshes in place when
//   it next comes up.
// - About to open: a tab not in memory starts loading when the pointer is over it or a finger on it.
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

type Message =
  { type: "changed" } | { type: "marked" } | { type: "owner"; owner: string } | { type: "gone" };

const CHANNEL = "jane:page-cache";
const ONE_HOUR_MS = 60 * 60_000;

// What a request may change on the pages: nothing (a read, a report), "little" (a chat message: the
// pages stay and refresh as they come up) or anything (every other post: they go now).
export type Change = "nothing" | "little" | "anything";
export function changeFrom(url: string, method: string, here: string): Change {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return "nothing";
  const target = new URL(url, here);
  if (target.origin !== new URL(here).origin) return "nothing";
  if (POSTS_THAT_CHANGE_NOTHING.includes(target.pathname)) return "nothing";
  return POSTS_THAT_CHANGE_LITTLE.includes(target.pathname) ? "little" : "anything";
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

// The pages a round asks for, from where the person is now: all of them the first time, the tabs
// when a change has emptied the memory. The page you're on is loaded as you leave it.
export function pagesToPreload(here: string, refill = false): string[] {
  if (NO_ROUND_FROM.includes(here)) return [];
  return (refill ? REFILL_PAGES : PRELOAD_PAGES).filter((page) => page !== here);
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
// The next round only brings the tabs back.
let refilling = false;
// The pages a round or a hover has loaded since the memory last emptied. Any other page is kept only
// until a page refreshes in place, so a tab you came in on, or were on when a round ran, went to the
// server when you came back to it; it's loaded as you leave it instead.
const preloaded = new Set<string>();
let shownPath: string | null = null;
// When the last chat message was sent, here or in another tab: a page made before it refreshes in
// place when it comes up.
let markedAt = 0;

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
  preloaded.clear();
  for (const step of steps) clearTimeout(step);
  steps = [];
  keep(here());
}

// The page on screen made again, and only it (src/lib/refresh-in-place.ts): router.refresh() would
// empty every page in memory. Its own post isn't a change of data; its id is learnt from the first.
let ownAction: string | null = null;
let learningOwnAction = false;
function refreshInPlace() {
  learningOwnAction = ownAction === null;
  void import("@/lib/refresh-in-place")
    .then(({ refreshInPlace }) => refreshInPlace())
    .catch(() => router?.refresh());
}

const actionOf = (init?: RequestInit) => {
  const headers = init?.headers;
  if (!headers) return null;
  return headers instanceof Headers
    ? headers.get("next-action")
    : ((headers as Record<string, string>)["next-action"] ??
        (headers as Record<string, string>)["Next-Action"] ??
        null);
};

function refreshNow() {
  refreshOwed = false;
  emptied();
  router?.refresh();
  refill();
}

// The memory was emptied: the tabs come back soon after the last change.
function refill() {
  refilling = rounds.length > 0;
  if (roundTimer) clearTimeout(roundTimer);
  roundTimer = null;
  scheduleRound(REFILL_AFTER_MS);
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

function changedALittle() {
  tell({ type: "marked" });
  markedAt = Date.now();
}

function dataChanged(actionHeader: string | null) {
  tell({ type: "changed" });
  // The chat's frame keeps no pages of its own: the window around it refreshes. A signed-out page
  // has none either (a form on the landing page, say).
  if (framed() || !owner) return;
  if (actionEmptiedCache(actionHeader)) {
    emptied();
    refill();
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
    const action = actionOf(init);
    if (action && learningOwnAction) {
      ownAction = action;
      learningOwnAction = false;
    }
    const change =
      action && action === ownAction ? "nothing" : changeFrom(url, method, window.location.href);
    if (change !== "nothing") {
      void result
        .then(async (response) => {
          if (!response.ok) return;
          // At the end of the reply: a chat answer does its work while it streams.
          await response
            .clone()
            .arrayBuffer()
            .catch(() => undefined);
          if (change === "little") changedALittle();
          else dataChanged(response.headers.get("x-action-revalidated"));
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
  if (
    NO_ROUND_FROM.includes(window.location.pathname) ||
    document.querySelector(STILL_LOADING_SELECTOR)
  ) {
    roundTimer = setTimeout(runRound, 500);
    return;
  }
  const start = () => {
    rounds.push(Date.now());
    rounds = rounds.slice(-PRELOAD_MAX_PER_HOUR);
    const pages = pagesToPreload(window.location.pathname, refilling);
    refilling = false;
    pages.forEach((page, i) => {
      const step = setTimeout(() => {
        // Whatever empties the router's memory, a later round fills it again.
        preload(page);
      }, i * PRELOAD_STEP_MS);
      steps.push(step);
    });
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 2_000 });
  else setTimeout(start, 200);
}

// Not for someone trying Jane: every preloaded page counts toward their 120 pages a minute
// (src/lib/edge-limits.ts), so after four pages their own taps were refused (debugger 11-06).
function mayPreload() {
  if (!owner || owner.startsWith(TRIAL_ID_PREFIX) || framed()) return false;
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  return connectionAllowsPreload(connection);
}

export function scheduleRound(after = PRELOAD_START_MS) {
  if (roundTimer || !mayPreload()) return;
  const at = nextRoundAt(rounds, Date.now() + after);
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
      else if (data.type === "marked") markedAt = Date.now();
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
    else if (roundOwed || roundRunOut()) scheduleRound();
    roundOwed = false;
  });
  // A tab about to be opened that isn't in memory starts loading now, a beat before the click.
  for (const type of ["pointerover", "touchstart"]) {
    document.addEventListener(type, (event) => aboutToOpen(event.target), {
      capture: true,
      passive: true,
    });
  }
}

// What the last round loaded has run out of the router's memory.
const roundRunOut = () => (rounds.at(-1) ?? 0) + PAGE_KEEP_SECONDS * 1000 < Date.now();

function aboutToOpen(target: EventTarget | null) {
  const link = (target as Element | null)?.closest?.(
    "#main-nav a[href]",
  ) as HTMLAnchorElement | null;
  if (!link?.href || !mayPreload()) return;
  const page = new URL(link.href).pathname;
  if (page === window.location.pathname || isInMemory(page)) return;
  preload(page);
}

function preload(page: string) {
  // Whatever empties the router's memory, a later round fills it again.
  router?.prefetch(page, { kind: "full", onInvalidate: refill });
  keep(page);
  preloaded.add(page);
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
  const left = shownPath;
  shownPath = window.location.pathname;
  if (
    left &&
    left !== shownPath &&
    !preloaded.has(left) &&
    (PRELOAD_PAGES as readonly string[]).includes(left) &&
    mayPreload()
  ) {
    preload(left);
  }
  if (opened) {
    fetch("/api/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opened),
      keepalive: true,
    }).catch(() => {});
  }
  // A page from memory shows at once; one that's old, or made before the last chat message, then
  // refreshes in place, and a round brings the others back.
  const age = ageOf(renderedAt, Date.now());
  if (age > PAGE_OLD_MS || Date.now() - age < markedAt) refreshInPlace();
  // The first time, and when what the last round loaded has run out.
  else if (roundRunOut()) scheduleRound();
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
  markedAt = 0;
  refilling = false;
  ownAction = null;
  learningOwnAction = false;
  preloaded.clear();
  shownPath = null;
}
