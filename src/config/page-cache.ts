// Moving between pages (src/lib/page-cache.ts). The numbers it runs on, in one place.

// How long the browser keeps a page it has opened or preloaded, in memory only. The router's
// staleTimes (next.config.ts) reads this.
export const PAGE_KEEP_SECONDS = 30 * 60;

// A page older than this shows at once, then refreshes quietly.
export const PAGE_OLD_MS = 5 * 60_000;
// ...once it has stayed on screen this long. Left sooner, the refresh would still be running, and
// the router turns an action cut short by a navigation into a full refresh, which empties every
// page in memory (CI, 11-12). A page passed by on the way to another refreshes when it's looked at.
export const REFRESH_IN_PLACE_AFTER_MS = 1_000;

// Loaded quietly once the first signed-in page has finished: the tabs, then /plan and /report. When
// a change of data has emptied the memory, only the tabs in the top bar come back (REFILL_PAGES).
export const PRELOAD_PAGES = [
  "/home",
  "/money",
  "/insurance",
  "/loans",
  "/taxes",
  "/investments",
  "/ahead",
  "/plan",
  "/report",
] as const;
export const REFILL_PAGES: readonly string[] = PRELOAD_PAGES.filter(
  (page) => page !== "/plan" && page !== "/report",
);

// No round from here: with no bank yet, Home's answer is a redirect to /connect, and the hand-off to
// Home would take it from memory. By the address, so it holds before the page has drawn.
export const NO_ROUND_FROM: readonly string[] = ["/scanning"];

// Spaced out, so a round never fills the database pool ahead of the page being opened (speed pass,
// 2026-10-24): one round is about 2,000 statements, and the router runs at most 4 at once. At 800 ms
// the last tab arrived about 6 s after the first page (founder 11-12: switching wasn't seamless).
export const PRELOAD_STEP_MS = 250;
// A round starts this long after the page that asked has settled; after a change of data, this long
// after the last change, so a few Yeses in a row bring one round.
export const PRELOAD_START_MS = 300;
export const REFILL_AFTER_MS = 0;
// Every change of data empties the memory, and the pages come back in a round soon after, so the
// next tab is there again (a 2-minute wait meant every tab after a Yes went to the server). Rounds
// are at most this often and this many an hour; past that, a page loads when it's opened.
export const PRELOAD_MIN_GAP_MS = 5_000;
export const PRELOAD_MAX_PER_HOUR = 10;
// How far along a connection must be for a round: below this, or with Save-Data on, none.
export const PRELOAD_SLOW_CONNECTIONS: readonly string[] = ["slow-2g", "2g", "3g"];

// A chat message rarely changes what a tab shows, and people send many. After one, a tab still comes
// from memory at once, and refreshes itself in place if it was made before the message.
export const POSTS_THAT_CHANGE_LITTLE: readonly string[] = ["/api/chat/send"];

// Posts that change nothing a page shows. Every other post from a signed-in page empties the cache,
// so a new route or action is safe without anyone remembering to add it anywhere.
export const POSTS_THAT_CHANGE_NOTHING: readonly string[] = [
  "/api/activity",
  "/api/client-error",
  "/api/csp-report",
  "/api/events",
  "/api/opened",
];

// A page from memory asks the server nothing, so a session ended somewhere else ("Sign out other
// devices", a deletion on another device, an expired one) wouldn't show. Whether it's still this
// person is asked when a page comes up or the tab comes back, at most this often.
export const STILL_HERE_EVERY_MS = 10_000;

// Reaching one of these with a person's pages in memory means they left: the memory goes.
export const SIGNED_OUT_PAGES: readonly string[] = ["/", "/login", "/signup", "/goodbye"];

// A running first scan or a page still streaming holds a round back. The first scan's own page too:
// with no bank yet, Home's answer is a redirect to /connect, which the hand-off would take from memory.
export const STILL_LOADING_SELECTOR =
  "main [data-loading-bar],[data-header-loading],[data-scan-bar],[data-scan-page],[data-nav-pending]";
