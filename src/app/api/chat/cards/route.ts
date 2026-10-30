import { NextResponse } from "next/server";
import { parseSkip, withoutGone } from "@/lib/dock-gone";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { getCurrentUser } from "@/lib/session";

// The card dock above the side chat (src/components/side-chat/card-dock.tsx): Jane's cards for
// the signed-in person, the same stack Home and the chat show. Without the ones the page says
// the person just dealt with (?skip=id,id): an answer may still be on its way here, and the
// card must not come back on the page it sent them to (src/lib/dock-gone.ts).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const skip = parseSkip(new URL(request.url).searchParams.get("skip"));
  const cards = withoutGone(await loadPopupStack(user.id), skip);
  return NextResponse.json({ cards }, { headers: { "cache-control": "no-store" } });
}
