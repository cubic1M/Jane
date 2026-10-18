import { NextResponse } from "next/server";
import { PlaidRequestError, plaidEnabled } from "@/lib/plaid/client";
import { ItemNotFoundError, createLinkToken } from "@/lib/plaid/link";
import { getCurrentUser } from "@/lib/session";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// A Plaid Link token for the signed-in user. With { itemId }, opens Link's update mode
// so they can reconnect that bank.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!plaidEnabled()) {
    return NextResponse.json({ error: "Bank linking isn't set up yet." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { itemId?: unknown };
  const itemId = body?.itemId ?? null;
  if (itemId !== null && (typeof itemId !== "string" || !ID_PATTERN.test(itemId))) {
    return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  }

  try {
    return NextResponse.json({ linkToken: await createLinkToken(user.id, itemId) });
  } catch (error) {
    if (error instanceof ItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PlaidRequestError) {
      console.error("Plaid link token failed", { code: error.code });
      return NextResponse.json({ error: "Couldn't start linking. Try again." }, { status: 502 });
    }
    throw error;
  }
}
