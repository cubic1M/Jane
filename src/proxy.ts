import { NextResponse, type NextRequest } from "next/server";
import { adminSessionState, sessionTokenFrom } from "@/lib/admin-gate";

// /admin answers everyone but admins with a 404, so its existence isn't revealed, and
// sends admins who haven't entered a two-factor code in this session to /mfa. The pages
// check again with requireAdmin(); this runs first so the status is a real 404.
export async function proxy(request: NextRequest) {
  const state = await adminSessionState(sessionTokenFrom(request.cookies));
  if (state === "verified") return NextResponse.next();
  if (state === "needs_mfa") {
    const target = new URL("/mfa", request.url);
    target.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(target);
  }
  return NextResponse.rewrite(new URL("/404", request.url), { status: 404 });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
