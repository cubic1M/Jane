import { NextResponse } from "next/server";
import { scopedFor } from "@/lib/db-scoped";
import { getCurrentUser } from "@/lib/session";

// The side chat's unread dot (docs/design/home-hub.md), checked while the chat is folded away:
// how many of Jane's messages the person hasn't seen. One cheap count. Seeing the chat marks
// them read (markChatRead), which clears it.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const unread = await scopedFor(user.id).janeMessages.count({
    // Visible in the chat now (the feed's rule, as /api/chat/pulse counts) and not yet read.
    where: {
      readAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
    },
  });
  return NextResponse.json({ unread }, { headers: { "cache-control": "no-store" } });
}
