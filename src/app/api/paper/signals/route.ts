import { NextResponse } from "next/server";
import { eventUpdates } from "@/lib/events/updates";
import { openSignalCards } from "@/lib/paper/signals";
import { getCurrentUser } from "@/lib/session";

// The trade pop-up's trades (src/components/trade-popup.tsx): the signed-in person's waiting paper
// trades, worded by the advice rule (src/lib/paper/wording.ts), and the events overlay's trades
// it placed by itself, not yet seen (src/lib/events/updates.ts). Never cached.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(
    {
      signals: await openSignalCards(user.id),
      updates: await eventUpdates(user.id),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
