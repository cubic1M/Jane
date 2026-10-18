import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIES, isAdminSession } from "@/lib/admin-gate";

// /admin answers everyone but admins with a 404, so its existence isn't revealed. The
// pages check again with requireAdmin(); this runs first so the status is a real 404
// rather than a streamed not-found page.
export async function proxy(request: NextRequest) {
  const token = SESSION_COOKIES.map((name) => request.cookies.get(name)?.value).find(Boolean);
  if (await isAdminSession(token)) return NextResponse.next();
  return NextResponse.rewrite(new URL("/404", request.url), { status: 404 });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
