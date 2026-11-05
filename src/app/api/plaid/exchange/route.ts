import { NextResponse, after } from "next/server";
import { TERMS_VERSION } from "@/config/legal";
import { FIRST_SYNC_TRIES, FIRST_SYNC_WAIT_MS } from "@/config/plaid";
import { log } from "@/lib/log";
import { limitOrNull } from "@/lib/rate-limit";
import { freshSwitches } from "@/lib/ops-switches";
import { PlaidRequestError, plaidEnabled } from "@/lib/plaid/client";
import { LinkingClosedError, linkClosedAnswer } from "@/lib/plaid/item-slots";
import { exchangePublicToken } from "@/lib/plaid/link";
import { syncItem } from "@/lib/plaid/sync";
import { syncFromWebhook } from "@/lib/plaid/webhooks";
import { getCurrentUser } from "@/lib/session";

const MAX_INSTITUTION_NAME = 100;

// The first sync, and a whole scan, run after the answer.
export const maxDuration = 300;

// Called by Plaid Link's onSuccess. Stores the item (the access token, encrypted, stays
// on the server) and runs the first sync after responding.
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

  const body = (await request.json().catch(() => null)) as {
    publicToken?: unknown;
    institutionName?: unknown;
  } | null;
  const publicToken = body?.publicToken;
  const institution = body?.institutionName;
  if (typeof publicToken !== "string" || !publicToken.startsWith("public-")) {
    return NextResponse.json({ error: "Invalid public token" }, { status: 400 });
  }
  const institutionName =
    typeof institution === "string" ? institution.slice(0, MAX_INSTITUTION_NAME) : null;

  let itemId: string;
  try {
    itemId = await exchangePublicToken(user.id, publicToken, institutionName);
  } catch (error) {
    if (error instanceof LinkingClosedError) {
      return NextResponse.json(linkClosedAnswer(error.reason), { status: 409 });
    }
    if (!(error instanceof PlaidRequestError)) throw error;
    log.error("Plaid token exchange failed", { code: error.code });
    return NextResponse.json(
      { error: "Linking didn't finish. Please try again." },
      { status: 502 },
    );
  }
  after(async () => {
    try {
      // Under the webhooks' lock: Plaid's webhook can arrive between tries, and only one may run a scan.
      for (let tries = 0; tries < FIRST_SYNC_TRIES; tries++) {
        let notReady = false;
        const ran = await syncFromWebhook(itemId, {
          sync: async (id) => {
            notReady = Boolean((await syncItem(id, { progressive: true }))?.notReady);
          },
        });
        if (!ran || !notReady) break;
        await new Promise((resolve) => setTimeout(resolve, FIRST_SYNC_WAIT_MS));
      }
    } catch (error) {
      log.error("First Plaid sync failed", { itemId, error: String(error) });
    }
  });
  return NextResponse.json({ itemId }, { status: 201 });
}
