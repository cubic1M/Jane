import { NextResponse, after } from "next/server";
import { PlaidRequestError, plaidEnabled } from "@/lib/plaid/client";
import { exchangePublicToken } from "@/lib/plaid/link";
import { syncItem } from "@/lib/plaid/sync";
import { getCurrentUser } from "@/lib/session";

const MAX_INSTITUTION_NAME = 100;

// Called by Plaid Link's onSuccess. Stores the item (the access token, encrypted, stays
// on the server) and runs the first sync after responding.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
    if (!(error instanceof PlaidRequestError)) throw error;
    console.error("Plaid token exchange failed", { code: error.code });
    return NextResponse.json(
      { error: "Linking didn't finish. Please try again." },
      { status: 502 },
    );
  }
  after(async () => {
    try {
      await syncItem(itemId);
    } catch (error) {
      console.error("First Plaid sync failed", { itemId, error: String(error) });
    }
  });
  return NextResponse.json({ itemId }, { status: 201 });
}
