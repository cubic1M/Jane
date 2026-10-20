import { NextResponse } from "next/server";
import { isFirstDetectionComplete } from "@/detection/engine";
import { scanReady } from "@/lib/scan";
import { getCurrentUser } from "@/lib/session";

// Polled by /scanning: has detection finished at least once for the signed-in user, and are
// their accounts and transactions in (the chat opens on that)?
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [complete, ready] = await Promise.all([
    isFirstDetectionComplete(user.id),
    scanReady(user.id),
  ]);
  // ready: accounts and transactions are in, enough to open the chat.
  return NextResponse.json({ complete, ready });
}
