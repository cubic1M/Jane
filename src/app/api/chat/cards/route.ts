import { NextResponse } from "next/server";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { getCurrentUser } from "@/lib/session";

// The card dock above the side chat (src/components/side-chat/card-dock.tsx): Jane's cards for
// the signed-in person, the same stack Home and the chat show.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const cards = await loadPopupStack(user.id);
  return NextResponse.json({ cards }, { headers: { "cache-control": "no-store" } });
}
