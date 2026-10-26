import { NextResponse } from "next/server";
import { openSignalCards } from "@/lib/paper/signals";
import { getCurrentUser } from "@/lib/session";

// The trade pop-up's trades (src/components/trade-popup.tsx): the signed-in person's waiting paper
// trades, worded by the advice rule (src/lib/paper/wording.ts). Never cached.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(
    { signals: await openSignalCards(user.id) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
