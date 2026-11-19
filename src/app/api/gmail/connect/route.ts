import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GMAIL_CALLBACK_PATH, GMAIL_LIMITS, gmailOffered, gmailOpen } from "@/config/gmail";
import { TERMS_VERSION } from "@/config/legal";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { track } from "@/lib/analytics";
import { fromAnotherSite } from "@/lib/from-another-site";
import { ticketHolds } from "@/lib/gmail/connect-ticket";
import { whyCantConnect } from "@/lib/gmail/mailbox";
import type { NoticeWord } from "@/lib/gmail/notice";
import { callbackOrigin, gmailSetUp, SIGN_IN_COOKIE, startSignIn } from "@/lib/gmail/oauth";
import { freshSwitches } from "@/lib/ops-switches";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { backToMailboxes } from "../back";

// The mailboxes page's own words for who can't connect (src/app/settings/mailboxes/page.tsx): a
// trial is sample data, and an account with only the demo bank can connect once it links a bank or
// uploads a statement.
const CANT_CONNECT: Record<"trial" | "demo", string> = {
  trial: "A sample account can't connect a mailbox.",
  demo: "This account only has the demo bank's sample data, so it can't connect a mailbox. Link your bank or upload a statement first.",
};

// The Connect link on the mailboxes page: starts a Google sign-in for one Gmail mailbox and sends the
// browser to Google's page, keeping what proves the answer coming back belongs to this person in a
// cookie only the way back reads. A link, because the site's security policy stops a form being sent
// on to another site. It goes on only with the ticket that page put in the link, made for this person
// in this browser's own session (src/lib/gmail/connect-ticket.ts): a sign-in link someone else sent
// can bring a person here signed in to the sender's account, but never with a ticket of that session.
// It saves nothing, and every other answer is a fixed status or the mailboxes page with a sealed word.
export async function GET(request: Request) {
  if (!gmailOffered()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.termsVersion !== TERMS_VERSION) {
    return NextResponse.json({ error: "Accept the Terms first." }, { status: 403 });
  }
  const origin = callbackOrigin(request);
  if (!gmailSetUp() || !origin) {
    return NextResponse.json({ error: "Connecting isn't set up yet." }, { status: 503 });
  }
  const back = (word: NoticeWord) => backToMailboxes(origin, user.id, word);

  if (fromAnotherSite(request)) return back("not_connected");
  const limited = await limitOrNull("gmail", user.id);
  if (limited) return limited;
  await freshSwitches();
  if (!gmailOpen()) return back("paused");
  const ticket = ticketHolds(new URL(request.url).searchParams.get("ticket"), {
    userId: user.id,
    sessionToken: sessionTokenFrom(await cookies()),
    now: new Date(),
  });
  // Not a click on the mailboxes page in this session: nothing starts, and that page says so beside
  // the name of the account they are signed in to.
  if (!ticket) return back("start_here");
  const why = await whyCantConnect(user.id);
  if (why) return NextResponse.json({ error: CANT_CONNECT[why] }, { status: 403 });

  const { url, cookie } = startSignIn(user.id, origin, ticket.disclosure);
  await track(user.id, "gmail_connect_started");
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(SIGN_IN_COOKIE, cookie, {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    // Google's page sends them back with a top-level link, which this lets through.
    sameSite: "lax",
    path: GMAIL_CALLBACK_PATH,
    maxAge: GMAIL_LIMITS.signInMinutes * 60,
  });
  return response;
}
