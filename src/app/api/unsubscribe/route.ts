import { NextResponse } from "next/server";
import { alertPrefs, withoutAlertEmails } from "@/lib/alerts";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { userFromUnsubscribeToken } from "@/lib/digest/unsubscribe";
import { chatNotifyPrefs, withoutChatEmails } from "@/lib/jane-agent/notify-prefs";
import { ipKey, limitOrNull } from "@/lib/rate-limit";

// Turns the weekly digest off without signing in, or with what=alerts, stops alert emails
// (alerts still show in the app), or with what=chat, stops Jane's emails of chat messages
// (spec step 85). Mail apps call it directly (List-Unsubscribe-Post,
// RFC 8058); the /unsubscribe page's button posts here too.
export async function POST(request: Request) {
  const limited = await limitOrNull("unsubscribe", ipKey(request.headers));
  if (limited) return limited;
  const url = new URL(request.url);
  const userId = userFromUnsubscribeToken(url.searchParams.get("token"));
  if (!userId) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  const asked = url.searchParams.get("what");
  const what = asked === "alerts" || asked === "chat" ? asked : "digest";

  if (what === "chat") {
    // Jane's emails of chat messages (spec step 85): email off, phone notifications kept.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { chatNotifyPrefs: true },
    });
    if (user) {
      await db.user.update({
        where: { id: userId },
        data: { chatNotifyPrefs: withoutChatEmails(chatNotifyPrefs(user.chatNotifyPrefs)) },
      });
      await track(userId, "chat_emails_unsubscribed", {});
    }
  } else if (what === "alerts") {
    const user = await db.user.findUnique({ where: { id: userId }, select: { alertPrefs: true } });
    if (user) {
      await db.user.update({
        where: { id: userId },
        data: { alertPrefs: withoutAlertEmails(alertPrefs(user.alertPrefs)) },
      });
      await track(userId, "alert_emails_unsubscribed", {});
    }
  } else {
    const { count } = await db.user.updateMany({
      where: { id: userId },
      data: { digestEnabled: false },
    });
    if (count > 0) {
      await logAudit({ type: "user", id: userId }, "digest_unsubscribed", {
        type: "user",
        id: userId,
      });
      await track(userId, "digest_unsubscribed", {});
    }
  }

  if (url.searchParams.get("from") === "page") {
    return NextResponse.redirect(new URL(`/unsubscribe?done=1&what=${what}`, url.origin), 303);
  }
  return NextResponse.json({ unsubscribed: true });
}
