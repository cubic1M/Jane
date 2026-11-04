import { NextResponse } from "next/server";
import {
  LINK_CONFIRM_COOKIE,
  LINK_CONFIRM_MINUTES,
  linkConfirmValue,
  signInLinkTarget,
} from "@/lib/sign-in-link";

const MAX_FIELD = 2_000;

// Another site's form could post here and set the cookie, which is the whole of what this page
// guards against. A server action would check this itself, but it follows its own redirect on the
// server, which uses the one-time link up before the browser gets there.
function fromThisSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || !URL.canParse(origin)) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return new URL(origin).host === host;
}

// The yes on /login/continue (src/lib/sign-in-link.ts). Nothing about the link is checked here:
// Auth.js does that next.
export async function POST(request: Request) {
  const site = new URL(request.url).origin;
  const back = (path: string) => NextResponse.redirect(new URL(path, site), 303);
  if (!fromThisSite(request)) return back("/login");
  const form = await request.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === "string" && value.length <= MAX_FIELD ? value : "";
  };
  const token = field("token");
  const email = field("email");
  if (!token || !email) return back("/login");
  const answer = back(signInLinkTarget({ token, email, callbackUrl: field("callbackUrl") }));
  answer.cookies.set(LINK_CONFIRM_COOKIE, linkConfirmValue(token, email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: LINK_CONFIRM_MINUTES * 60,
    path: "/",
  });
  return answer;
}
