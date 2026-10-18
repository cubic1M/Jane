import { NextResponse } from "next/server";
import { parseSubscription, pushEnabled, removeSubscription, saveSubscription } from "@/lib/push";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

async function guard() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!pushEnabled()) {
    return { error: NextResponse.json({ error: "Notifications aren't set up" }, { status: 404 }) };
  }
  const limited = await limitOrNull("push", user.id);
  return limited ? { error: limited } : { user };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Turns phone notifications on for this device.
export async function POST(request: Request) {
  const { user, error } = await guard();
  if (error) return error;
  const subscription = parseSubscription(await readJson(request));
  if (!subscription) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  await saveSubscription(user.id, subscription);
  return NextResponse.json({ ok: true }, { status: 201 });
}

// Turns them off for this device.
export async function DELETE(request: Request) {
  const { user, error } = await guard();
  if (error) return error;
  const endpoint = (await readJson(request)) as { endpoint?: unknown } | null;
  if (typeof endpoint?.endpoint !== "string") {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  await removeSubscription(user.id, endpoint.endpoint);
  return NextResponse.json({ ok: true });
}
