import { NextResponse } from "next/server";
import { TERMS_VERSION } from "@/config/legal";
import { ENDED_ITEM_PLAID_CODES } from "@/config/plaid";
import { log } from "@/lib/log";
import { limitOrNull } from "@/lib/rate-limit";
import { freshSwitches } from "@/lib/ops-switches";
import { PlaidRequestError, plaidEnabled } from "@/lib/plaid/client";
import { LinkingClosedError, linkClosedAnswer } from "@/lib/plaid/item-slots";
import { ItemNotFoundError, createLinkToken } from "@/lib/plaid/link";
import { getCurrentUser } from "@/lib/session";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// A Plaid Link token for the signed-in user. With { itemId }, opens Link's update mode
// so they can reconnect that bank.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // A direct call isn't past the Terms just because the page would have been.
  if (user.termsVersion !== TERMS_VERSION) {
    return NextResponse.json({ error: "Accept the Terms first." }, { status: 403 });
  }
  const limited = await limitOrNull("plaid", user.id);
  if (limited) return limited;
  await freshSwitches();
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
    if (error instanceof LinkingClosedError) {
      return NextResponse.json(linkClosedAnswer(error.reason), { status: 409 });
    }
    if (error instanceof ItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (
      error instanceof PlaidRequestError &&
      itemId !== null &&
      error.code !== null &&
      ENDED_ITEM_PLAID_CODES.includes(error.code)
    ) {
      return NextResponse.json(
        {
          error: "This bank connection has ended. Remove the bank in Settings, then link it again.",
        },
        { status: 410 },
      );
    }
    if (error instanceof PlaidRequestError) {
      log.error("Plaid link token failed", { code: error.code });
      return NextResponse.json({ error: "Couldn't start linking. Try again." }, { status: 502 });
    }
    throw error;
  }
}
