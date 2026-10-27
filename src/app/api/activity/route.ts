import { NextRequest, NextResponse } from "next/server";
import { ACTIVITY } from "@/config/activity";
import { recordActivity } from "@/lib/activity/record";
import { ipKey, limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

// The beta's activity log (src/lib/activity/): batches of page views, clicks, form submits and
// field focus from the browser. Kept only for real signed-in beta users, and anonymous views of
// the landing page; the answer tells the browser whether to keep sending the rest.
export async function POST(request: NextRequest) {
  const limited = await limitOrNull("activity", ipKey(request.headers));
  if (limited) return limited;
  const text = await request.text();
  if (text.length > ACTIVITY.maxBodyBytes) {
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const user = await getCurrentUser();
  const result = await recordActivity(user ? { id: user.id, role: user.role } : null, body);
  if (!result.ok) return NextResponse.json({ error: "Invalid batch" }, { status: 400 });
  return NextResponse.json({ recording: result.recording === "user" });
}
