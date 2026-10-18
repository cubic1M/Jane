import { NextResponse } from "next/server";
import { isFirstDetectionComplete } from "@/detection/engine";
import { getCurrentUser } from "@/lib/session";

// Polled by /scanning: has detection finished at least once for the signed-in user?
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ complete: await isFirstDetectionComplete(user.id) });
}
