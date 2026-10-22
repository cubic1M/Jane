import { NextResponse } from "next/server";
import { scanProgress } from "@/lib/scan";
import { getCurrentUser } from "@/lib/session";

// Polled by /scanning: how far the signed-in user's first scan has got (see scanProgress),
// and the two things the screen waits for: detection finished at least once (complete) and
// accounts and transactions in, enough to open the chat (ready).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const progress = await scanProgress(user.id);
  return NextResponse.json({
    complete: progress.detection,
    ready: progress.transactions,
    progress,
  });
}
