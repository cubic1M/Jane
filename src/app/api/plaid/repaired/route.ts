import { NextResponse, after } from "next/server";
import { limitOrNull } from "@/lib/rate-limit";
import { ItemNotFoundError, markItemRepaired } from "@/lib/plaid/link";
import { syncFromWebhook } from "@/lib/plaid/webhooks";
import { getCurrentUser } from "@/lib/session";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// Link's update mode finished for one of the signed-in person's banks: it stops asking for a
// sign-in (or for new accounts to be shared) and syncs after the response, one sync at a time.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("plaid", user.id);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { itemId?: unknown };
  const itemId = body?.itemId;
  if (typeof itemId !== "string" || !ID_PATTERN.test(itemId)) {
    return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  }
  try {
    await markItemRepaired(user.id, itemId);
  } catch (error) {
    if (error instanceof ItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
  after(async () => {
    try {
      await syncFromWebhook(itemId);
    } catch (error) {
      console.error("Plaid sync after update mode failed", { itemId, error: String(error) });
    }
  });
  return NextResponse.json({ ok: true });
}
