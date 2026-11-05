import { NextResponse } from "next/server";
import { TERMS_VERSION } from "@/config/legal";
import {
  ROBINHOOD_CALLBACK_PATH,
  ROBINHOOD_LIMITS,
  robinhoodOffered,
  robinhoodOpen,
} from "@/config/robinhood";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { log } from "@/lib/log";
import { freshSwitches } from "@/lib/ops-switches";
import { limitOrNull } from "@/lib/rate-limit";
import { whyCantConnect } from "@/lib/robinhood/connection";
import {
  callbackOrigin,
  fromAnotherSite,
  RobinhoodOAuthError,
  SIGN_IN_COOKIE,
  startSignIn,
} from "@/lib/robinhood/oauth";
import { getCurrentUser } from "@/lib/session";

// The Connect link: starts a Robinhood sign-in and goes to Robinhood's page, keeping what proves the
// answer coming back belongs to this person in a cookie only the way back reads. A link, because the
// site's security policy stops a form being sent on to another site. It saves nothing, and going to
// Robinhood's page is all another site could make it do, so one that links here gets sent to Jane.
export async function GET(request: Request) {
  if (!robinhoodOffered()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.termsVersion !== TERMS_VERSION) {
    return NextResponse.json({ error: "Accept the Terms first." }, { status: 403 });
  }
  const origin = callbackOrigin(request);
  if (!origin) {
    return NextResponse.json({ error: "Connecting isn't set up yet." }, { status: 503 });
  }
  const back = (word: "not_connected" | "paused") =>
    NextResponse.redirect(new URL(`/investments?robinhood=${word}`, origin), 303);

  if (fromAnotherSite(request)) return back("not_connected");
  const limited = await limitOrNull("robinhood", user.id);
  if (limited) return limited;
  await freshSwitches();
  if (!robinhoodOpen()) return back("paused");
  if (await whyCantConnect(user.id)) {
    return NextResponse.json(
      { error: "Sample accounts can't connect to Robinhood." },
      { status: 403 },
    );
  }
  try {
    const { url, cookie } = await startSignIn(user.id, origin);
    await track(user.id, "robinhood_connect_started");
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(SIGN_IN_COOKIE, cookie, {
      httpOnly: true,
      secure: origin.startsWith("https:"),
      // Robinhood's page sends them back with a top-level link, which this lets through.
      sameSite: "lax",
      path: ROBINHOOD_CALLBACK_PATH,
      maxAge: ROBINHOOD_LIMITS.signInMinutes * 60,
    });
    return response;
  } catch (error) {
    if (!(error instanceof RobinhoodOAuthError)) throw error;
    log.error("Robinhood sign-in didn't start", { code: error.code });
    await logAudit(
      { type: "user", id: user.id },
      "robinhood_connect_failed",
      { type: "user", id: user.id },
      { user_id: user.id, code: error.code },
    );
    return back("not_connected");
  }
}
