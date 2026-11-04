import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ACTION_BODY_MAX_BYTES, ACTION_UPLOAD_PAGES } from "@/config/rate-limits";
import { TRIAL_SESSION_PREFIX } from "@/config/trial";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { log } from "@/lib/log";
import {
  TOO_MANY_MESSAGE,
  clientIp,
  hitMany,
  ipKey,
  type Check,
  type RateResult,
} from "@/lib/rate-limit";

// Rate limits at the edge (src/proxy.ts), before anything else runs: every API route, every
// server action, and the way back from a sign-in link or Google. Per IP, and per signed-in
// session (sample people's sessions get tighter ones). Postgres keeps the counters, in one
// round trip. The per-feature limits (sign-in, chat, Plaid, two-factor...) still apply on top.
// Cron routes are left alone: CRON_SECRET guards them, and only Vercel calls them.

type EdgeRequest = {
  method: string;
  pathname: string;
  headers: Headers;
  cookies: { get(name: string): { value: string } | undefined };
};

export type EdgeKind = "api" | "action" | "authCallback" | "page";

// Which kind of request this is, or null for one with no backstop (pages, cron).
export function edgeKind({ method, pathname, headers, cookies }: EdgeRequest): EdgeKind | null {
  if (pathname.startsWith("/api/cron/")) return null;
  if (pathname.startsWith("/api/auth/callback/")) return "authCallback";
  if (pathname.startsWith("/api/")) return "api";
  // A form with no JavaScript runs an action with no header, so any POST to a page counts.
  if (method === "POST") return "action";
  // A prefetch stops at the page's loading state, and a page holds many links to prefetch. It's
  // only a prefetch to Next.js with both headers: one alone renders the whole page.
  const trial = sessionTokenFrom(cookies)?.startsWith(TRIAL_SESSION_PREFIX);
  const prefetch = headers.has("next-router-prefetch") && headers.has("rsc");
  if (trial && (method === "GET" || method === "HEAD") && !prefetch) return "page";
  return null;
}

// A counter id for the session behind the cookie: never the token itself.
function sessionSubject(token: string): string {
  return createHash("sha256").update(`session:${token}`).digest("hex").slice(0, 32);
}

// The counters this request goes up by. No IP counter where there's no IP (only local runs:
// Vercel always sets one), so the end-to-end tests' many browsers don't share one.
export function edgeChecks(request: EdgeRequest): Check[] {
  const kind = edgeKind(request);
  if (!kind) return [];
  const ip = clientIp(request.headers) ? ipKey(request.headers) : null;
  if (kind === "authCallback") return ip ? [{ name: "authCallback", subject: ip }] : [];

  const token = sessionTokenFrom(request.cookies);
  if (kind === "page") {
    return [
      ...(ip ? [{ name: "trialPagesIp" as const, subject: ip }] : []),
      { name: "trialPages", subject: sessionSubject(token!) },
    ];
  }
  const checks: Check[] = ip ? [{ name: kind === "api" ? "api" : "actions", subject: ip }] : [];
  if (token) {
    const trial = token.startsWith(TRIAL_SESSION_PREFIX);
    const name =
      kind === "api"
        ? trial
          ? "trialApi"
          : "apiSession"
        : trial
          ? "trialActions"
          : "actionsSession";
    checks.push({ name, subject: sessionSubject(token) });
  }
  return checks;
}

// The 429 for this kind of request. A server action's caller shows a text/plain body as the
// error's message; API callers get JSON, like every other route's refusal.
export function refusal(kind: EdgeKind, result: RateResult): NextResponse {
  const headers = { "Retry-After": String(result.retryAfterSeconds) };
  if (kind === "action" || kind === "page") {
    return new NextResponse(TOO_MANY_MESSAGE, {
      status: 429,
      headers: { ...headers, "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: TOO_MANY_MESSAGE }, { status: 429, headers });
}

// Auth.js takes any cookie starting with its name as part of a split session (a session here never
// needs splitting), and sessionTokenFrom reads only the exact names. So a split one signs someone in
// while every limit here sees no session.
const oddSessionCookie = (cookie: string | null) =>
  /(?:^|;\s*)(?:__Secure-)?authjs\.session-token[^=;\s]+\s*=/.test(cookie ?? "");

const onUploadPage = (pathname: string) =>
  ACTION_UPLOAD_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));

// Going by what the request says of itself, and refused before anything reads it. One that doesn't
// say goes on: browsers always do, and a wrong guess here would stop every form. The field checks
// still stand.
function actionTooBig(request: EdgeRequest): boolean {
  if (edgeKind(request) !== "action" || onUploadPage(request.pathname)) return false;
  return Number(request.headers.get("content-length")) > ACTION_BODY_MAX_BYTES;
}

// Null when the request may go on, else the 429 or 413 to send. A database hiccup lets the request
// through: the routes' own limits and checks still stand, and Jane stays up.
export async function edgeLimit(
  request: EdgeRequest,
  { hit = hitMany }: { hit?: typeof hitMany } = {},
): Promise<NextResponse | null> {
  if (oddSessionCookie(request.headers.get("cookie"))) {
    return new NextResponse("Please clear this site's cookies and sign in again.", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }
  if (actionTooBig(request)) {
    return new NextResponse("That's too much text to send.", {
      status: 413,
      headers: { "Content-Type": "text/plain" },
    });
  }
  const checks = edgeChecks(request);
  if (checks.length === 0) return null;
  let result: RateResult;
  try {
    result = await hit(checks);
  } catch (error) {
    log.error("Edge rate limit unavailable", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
  return result.ok ? null : refusal(edgeKind(request)!, result);
}
