import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ROBINHOOD_CALLBACK_PATH, robinhoodOffered, robinhoodOpen } from "@/config/robinhood";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { log } from "@/lib/log";
import { freshSwitches } from "@/lib/ops-switches";
import { saveConnection, whyCantConnect } from "@/lib/robinhood/connection";
import {
  callbackOrigin,
  exchangeCode,
  matchSignIn,
  RobinhoodGrantGoneError,
  RobinhoodOAuthError,
  SIGN_IN_COOKIE,
} from "@/lib/robinhood/oauth";
import { refreshConnection } from "@/lib/robinhood/refresh";
import { getCurrentUser } from "@/lib/session";

// The way back from Robinhood's page. Its path is registered with Robinhood, so it stays. Every answer
// goes back to /investments with one fixed word; nothing from the address bar is shown or stored.
export async function GET(request: Request) {
  if (!robinhoodOffered()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const origin = callbackOrigin(request);
  if (!origin) return NextResponse.json({ error: "Not set up" }, { status: 503 });

  const back = (word: "connected" | "not_connected" | "paused") => {
    const response = NextResponse.redirect(new URL(`/investments?robinhood=${word}`, origin), 303);
    // The sign-in is used up, whichever way it went.
    response.cookies.set(SIGN_IN_COOKIE, "", { path: ROBINHOOD_CALLBACK_PATH, maxAge: 0 });
    return response;
  };
  const failed = async (code: string) => {
    await logAudit(
      { type: "user", id: user.id },
      "robinhood_connect_failed",
      { type: "user", id: user.id },
      { user_id: user.id, code },
    );
    return back("not_connected");
  };

  await freshSwitches();
  if (!robinhoodOpen()) return back("paused");

  const params = new URL(request.url).searchParams;
  const signIn = matchSignIn((await cookies()).get(SIGN_IN_COOKIE)?.value, {
    userId: user.id,
    state: params.get("state"),
  });
  // Not the sign-in this person started: nothing from the address bar is trusted, or used.
  if (!signIn) return failed("state");
  const code = params.get("code");
  if (!code) return failed(params.get("error") === "access_denied" ? "denied" : "no_code");
  if (await whyCantConnect(user.id)) return failed("refused");

  try {
    const tokens = await exchangeCode(signIn, code);
    const { id, reconnected } = await saveConnection(user.id, tokens, signIn.clientId);
    await logAudit(
      { type: "user", id: user.id },
      "robinhood_connected",
      { type: "robinhood_connection", id },
      { user_id: user.id, reconnected },
    );
    await track(user.id, "robinhood_connected", { reconnected });
    // The first read. Its failure is on the connection, with what the page says about it.
    await refreshConnection(user.id);
    return back("connected");
  } catch (error) {
    if (!(error instanceof RobinhoodOAuthError || error instanceof RobinhoodGrantGoneError)) {
      throw error;
    }
    const failure = error instanceof RobinhoodOAuthError ? error.code : "grant";
    log.error("Robinhood sign-in didn't finish", { code: failure });
    return failed(failure);
  }
}
