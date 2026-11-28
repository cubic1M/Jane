import { NextResponse } from "next/server";
import { parseSkip, withoutGone } from "@/lib/dock-gone";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { withRequestMemo } from "@/lib/read-memo";
import { getCurrentUser } from "@/lib/session";

// The card dock above the side chat (src/components/side-chat/card-dock.tsx): Jane's cards for
// the signed-in person, the same stack Home and the chat show. Without the ones the page says
// the person just dealt with (?skip=id,id): an answer may still be on its way here, and the
// card must not come back on the page it sent them to (src/lib/dock-gone.ts).
//
// Not a page render, so nothing shared what its loaders read: the person's day, their modes and
// the year's charges were each read again by every card check (24 reads of one user row and two
// reads of every transaction). Inside withRequestMemo the request shares its reads as a render
// does (src/lib/read-memo.ts): a repeated question has one answer, a small table or the year's
// transactions is read once for all that ask of it (src/lib/row-snapshots.ts), and any write
// forgets what was shared.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const skip = parseSkip(new URL(request.url).searchParams.get("skip"));
  const stack = await withRequestMemo(() => loadPopupStack(user.id));
  const cards = withoutGone(stack, skip);
  return NextResponse.json({ cards }, { headers: { "cache-control": "no-store" } });
}
