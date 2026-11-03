import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { logAdminAccess } from "@/lib/admin-access";
import { SITE_PAUSED_TEXT, killed } from "@/config/kill-switches";
import { adminSession, sessionTokenFrom } from "@/lib/admin-gate";
import { edgeLimit } from "@/lib/edge-limits";
import { log } from "@/lib/log";
import { newNonce, pageCsp } from "@/lib/security-headers";

// Runs before every page, API route and server action. Three jobs, after the emergency stop:
// - Rate limits for every API route and server action, per IP and per session
//   (src/lib/edge-limits.ts): over the limit, a calm 429 and nothing else runs.
// - /admin answers everyone but admins with a 404, so its existence isn't revealed, and
//   sends admins who haven't entered a two-factor code in this session to /mfa. The pages
//   check again with requireAdmin(); this runs first so the status is a real 404. Every
//   admin page view and action goes on the access log (src/lib/admin-access.ts).
// - Every page gets a Content-Security-Policy with a fresh nonce. Next.js reads it from the
//   request and puts the nonce on its own scripts; nothing else runs (docs/security/edge.md).
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  // The emergency stop (docs/incident.md), ahead of everything including the database.
  if (killed("site")) {
    return new NextResponse(SITE_PAUSED_TEXT, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "600" },
    });
  }
  const { pathname } = request.nextUrl;
  const limited = await edgeLimit({
    method: request.method,
    pathname,
    headers: request.headers,
    cookies: request.cookies,
  });
  if (limited) return limited;
  // API routes set their own headers (next.config.ts).
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const csp = pageCsp(pathname, newNonce(), process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const init = { request: { headers } };

  let response = NextResponse.next(init);
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const { state, userId } = await adminSession(sessionTokenFrom(request.cookies));
    if (state === "verified" && userId) {
      const access = { method: request.method, pathname, headers: request.headers };
      event.waitUntil(
        logAdminAccess(userId, access).catch((error) =>
          log.error("Couldn't log an admin view", {
            error: error instanceof Error ? error.name : "unknown",
          }),
        ),
      );
    }
    if (state === "needs_mfa") {
      const target = new URL("/mfa", request.url);
      target.searchParams.set("next", pathname);
      return NextResponse.redirect(target);
    }
    if (state !== "verified") {
      response = NextResponse.rewrite(new URL("/404", request.url), { ...init, status: 404 });
    }
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Not Next.js's own files or the files in public/, by name. "Anything with a dot" also let
// /report/abc.x past the rate limits, the Content-Security-Policy and the admin log.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$|sw\\.js$|landing/).*)"],
};
