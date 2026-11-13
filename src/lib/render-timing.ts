import { cache } from "react";

// How long a signed-in page takes on the server, and where the time goes (founder 11-13: "the
// loading takes a long time"). One line per render in the logs, searched for "render timing":
// the page's first path segment, how it was asked for, the total, the database's share, how many
// round trips and connections that took, and whether this function instance had just started.
// Nothing about the person. docs/perf/first-load.md.
//
// A streamed page sends its headers before its render ends, and a server component can't set
// them, so the numbers go to the log rather than a Server-Timing header.

// The page's path, set by the proxy on every page request (src/proxy.ts), so a render knows which
// page it is. API routes don't get it.
export const PAGE_PATH_HEADER = "x-jane-page";

export type RenderTiming = {
  startedAt: number;
  roundTrips: number;
  sqlCount: number;
  // Time with at least one statement in flight: parallel statements count once.
  dbMs: number;
  inFlight: number;
  busySince: number;
  connects: number;
  connectMs: number;
};

// Once per request inside a render (React's cache); outside one (a script, a cron, a route
// handler) every call makes a fresh one that nothing reads, which costs nothing.
export const renderTiming = cache((): RenderTiming => ({
  startedAt: performance.now(),
  roundTrips: 0,
  sqlCount: 0,
  dbMs: 0,
  inFlight: 0,
  busySince: 0,
  connects: 0,
  connectMs: 0,
}));

// One round trip to the database carrying `statements` statements. Call what it returns when
// the answer is in.
export function roundTripStarted(statements: number, timing = renderTiming()): () => void {
  timing.roundTrips += 1;
  timing.sqlCount += statements;
  if (timing.inFlight === 0) timing.busySince = performance.now();
  timing.inFlight += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    timing.inFlight -= 1;
    if (timing.inFlight === 0) timing.dbMs += performance.now() - timing.busySince;
  };
}

// A new connection to the database (TCP, TLS and sign-in, before any statement).
export function connectStarted(timing = renderTiming()): () => void {
  const at = performance.now();
  timing.connects += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    timing.connectMs += performance.now() - at;
  };
}

// The first render this instance serves pays for its start: loading the code, and the database
// connections it opens.
let rendersServed = 0;

export function resetRenderTimingForTests() {
  rendersServed = 0;
}

export type RenderKind = "document" | "rsc" | "action";

// What the request was, from its headers: a whole page (a first load or a reload), a page asked
// for by the app (a tab, a preload, a refresh), or a server action.
export function renderKind(headers: Pick<Headers, "get">): RenderKind {
  if (headers.get("next-action")) return "action";
  if (headers.get("rsc") === "1") return "rsc";
  return "document";
}

// Only the first part of the path: /s/<token> and /report/<id> keep their token and id to
// themselves.
export function pageOf(path: string | null): string | null {
  if (!path) return null;
  const first = /^\/([a-z0-9-]{1,40})(?:[/?#]|$)/.exec(path);
  return first ? `/${first[1]}` : path === "/" ? "/" : null;
}

export function renderLine(
  timing: RenderTiming,
  page: string,
  kind: RenderKind,
  now = performance.now(),
): Record<string, unknown> {
  rendersServed += 1;
  return {
    page,
    kind,
    ms: Math.round(now - timing.startedAt),
    dbMs: Math.round(timing.dbMs + (timing.inFlight > 0 ? now - timing.busySince : 0)),
    roundTrips: timing.roundTrips,
    sqlCount: timing.sqlCount,
    connects: timing.connects,
    connectMs: Math.round(timing.connectMs),
    cold: rendersServed === 1,
    uptimeS: Math.round(process.uptime()),
    region: process.env.VERCEL_REGION ?? "local",
  };
}
