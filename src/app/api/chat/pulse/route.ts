import { NextResponse } from "next/server";
import { scopedFor } from "@/lib/db-scoped";
import { getCurrentUser } from "@/lib/session";

// Polled by the open chat during the first scan (ScanRefresher): how many messages the chat
// would show now. One cheap count, so it answers fast even while the scan is busy, unlike
// reloading the whole page every few seconds. The chat reloads itself when the count moves.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const count = await scopedFor(user.id).janeMessages.count({
    // The same rule as the chat's feed (src/lib/jane-agent/messages.ts, chatFeed).
    where: { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] },
  });
  return NextResponse.json({ count }, { headers: { "cache-control": "no-store" } });
}
