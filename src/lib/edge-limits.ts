import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { TRIAL_SESSION_PREFIX } from "@/config/trial";
import { sessionTokenFrom } from "@/lib/admin-gate";
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

export type EdgeKind = "api" | "action" | "authCallback";

// Which kind of request this is, or null for one with no backstop (pages, cron).
export function edgeKind({ method, pathname, headers }: EdgeRequest): EdgeKind | null {
  if (pathname.startsWith("/api/cron/")) return null;
  if (pathname.startsWith("/api/auth/callback/")) return "authCallback";
  if (pathname.startsWith("/api/")) return "api";
  if (method === "POST" && headers.has("next-action")) return "action";
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

  const checks: Check[] = ip ? [{ name: kind === "api" ? "api" : "actions", subject: ip }] : [];
  const token = sessionTokenFrom(request.cookies);
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
  if (kind === "action") {
    return new NextResponse(TOO_MANY_MESSAGE, {
      status: 429,
      headers: { ...headers, "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: TOO_MANY_MESSAGE }, { status: 429, headers });
}

// Null when the request may go on, else the 429 to send. A database hiccup lets the request
// through: the routes' own limits and checks still stand, and Jane stays up.
export async function edgeLimit(
  request: EdgeRequest,
  { hit = hitMany }: { hit?: typeof hitMany } = {},
): Promise<NextResponse | null> {
  const checks = edgeChecks(request);
  if (checks.length === 0) return null;
  let result: RateResult;
  try {
    result = await hit(checks);
  } catch (error) {
    console.error("Edge rate limit unavailable", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
  return result.ok ? null : refusal(edgeKind(request)!, result);
}
