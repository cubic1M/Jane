import { NextResponse } from "next/server";
import { robinhoodOffered } from "@/config/robinhood";
import { fromAnotherSite } from "@/lib/from-another-site";
import { limitOrNull } from "@/lib/rate-limit";
import { connectionView, removeConnection } from "@/lib/robinhood/connection";
import { callbackOrigin } from "@/lib/robinhood/oauth";
import { getCurrentUser } from "@/lib/session";

// The Disconnect form: deletes the person's Robinhood connection and everything read through it, then
// back to the Investing page. Taking access away is always allowed: neither KILL_BANKS nor
// ROBINHOOD_LINK being off stops it. Off, the route is there only for someone with a stored connection.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!robinhoodOffered() && !(user && (await connectionView(user.id)))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const origin = callbackOrigin(request) ?? new URL(request.url).origin;
  if (fromAnotherSite(request)) {
    return NextResponse.redirect(new URL("/investments", origin), 303);
  }
  const limited = await limitOrNull("robinhood", user.id);
  if (limited) return limited;
  await removeConnection(user.id, "user_disconnected");
  return NextResponse.redirect(new URL("/investments?robinhood=disconnected", origin), 303);
}
