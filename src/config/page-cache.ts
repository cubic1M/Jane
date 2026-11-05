// Moving between pages (src/lib/page-cache.ts). The numbers it runs on, in one place.

// How long the browser keeps a page it has opened or preloaded, in memory only. The router's
// staleTimes (next.config.ts) reads this.
export const PAGE_KEEP_SECONDS = 30 * 60;

// A page older than this shows at once, then refreshes quietly.
export const PAGE_OLD_MS = 5 * 60_000;

// Loaded quietly once the first signed-in page has finished: the tabs, then /plan and /report.
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

// One page at a time, so a round never fills the database pool ahead of the page being opened
// (speed pass, 2026-10-24): one round is about 2,000 statements.
export const PRELOAD_STEP_MS = 800;
// A round starts this long after the page that asked has settled.
export const PRELOAD_START_MS = 300;
// Every change of data empties the cache, so a busy person could ask for many rounds. At most this
// often and this many per hour; past that, a page loads when it's opened.
export const PRELOAD_MIN_GAP_MS = 2 * 60_000;
export const PRELOAD_MAX_PER_HOUR = 10;
// How far along a connection must be for a round: below this, or with Save-Data on, none.
export const PRELOAD_SLOW_CONNECTIONS: readonly string[] = ["slow-2g", "2g", "3g"];

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

// A running first scan or a page still streaming holds a round back.
export const STILL_LOADING_SELECTOR =
  "main [data-loading-bar],[data-header-loading],[data-scan-bar],[data-nav-pending]";
