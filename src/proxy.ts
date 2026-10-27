import { NextResponse, type NextRequest } from "next/server";
import { adminSessionState, sessionTokenFrom } from "@/lib/admin-gate";
import { newNonce, pageCsp } from "@/lib/security-headers";

// Runs before every page. Two jobs:
// - /admin answers everyone but admins with a 404, so its existence isn't revealed, and
//   sends admins who haven't entered a two-factor code in this session to /mfa. The pages
//   check again with requireAdmin(); this runs first so the status is a real 404.
// - Every page gets a Content-Security-Policy with a fresh nonce. Next.js reads it from the
//   request and puts the nonce on its own scripts; nothing else runs (docs/security/edge.md).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // API routes set their own headers (next.config.ts).
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const csp = pageCsp(pathname, newNonce(), process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const init = { request: { headers } };

  let response = NextResponse.next(init);
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const state = await adminSessionState(sessionTokenFrom(request.cookies));
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

// Not Next.js's own files or the files in public/ (anything with a dot, like sw.js or a font).
export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
