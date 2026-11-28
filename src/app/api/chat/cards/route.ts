import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseSkip, withoutGone } from "@/lib/dock-gone";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { withReadCache } from "@/lib/read-cache";
import { getCurrentUser } from "@/lib/session";

// The card dock above the side chat (src/components/side-chat/card-dock.tsx): Jane's cards for
// the signed-in person, the same stack Home and the chat show. Without the ones the page says
// the person just dealt with (?skip=id,id): an answer may still be on its way here, and the
// card must not come back on the page it sent them to (src/lib/dock-gone.ts).
//
// Not a page render, so nothing shares what its loaders read: the person's day, their modes and
// the year's charges were each read again by every card check (24 reads of one user row and two
// reads of every transaction). With a read cache for the request each is read once, and a write
// forgets what it touched (src/lib/read-cache.ts).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const skip = parseSkip(new URL(request.url).searchParams.get("skip"));
  const stack = await withReadCache(db, (client) => loadPopupStack(user.id, { client }));
  const cards = withoutGone(stack, skip);
  return NextResponse.json({ cards }, { headers: { "cache-control": "no-store" } });
}
