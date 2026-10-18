import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { userFromUnsubscribeToken } from "@/lib/digest/unsubscribe";
import { ipKey, limitOrNull } from "@/lib/rate-limit";

// Turns the weekly digest off without signing in. Mail apps call it directly
// (List-Unsubscribe-Post, RFC 8058); the /unsubscribe page's button posts here too.
export async function POST(request: Request) {
  const limited = await limitOrNull("unsubscribe", ipKey(request.headers));
  if (limited) return limited;
  const url = new URL(request.url);
  const userId = userFromUnsubscribeToken(url.searchParams.get("token"));
  if (!userId) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

  const { count } = await db.user.updateMany({
    where: { id: userId },
    data: { digestEnabled: false },
  });
  if (count > 0) await track(userId, "digest_unsubscribed", {});

  if (url.searchParams.get("from") === "page") {
    return NextResponse.redirect(new URL("/unsubscribe?done=1", url.origin), 303);
  }
  return NextResponse.json({ unsubscribed: true });
}
