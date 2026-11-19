import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { GMAIL_CALLBACK_PATH, gmailOffered, gmailOpen } from "@/config/gmail";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { getProfile, type Access } from "@/lib/gmail/api";
import { GmailSignedOutError, GoogleCallError } from "@/lib/gmail/google";
import { heldByAnyone, saveMailbox, whyCantConnect } from "@/lib/gmail/mailbox";
import type { NoticeWord } from "@/lib/gmail/notice";
import {
  callbackOrigin,
  exchangeCode,
  matchSignIn,
  revokeTokens,
  SIGN_IN_COOKIE,
  type Tokens,
} from "@/lib/gmail/oauth";
import { syncMailbox } from "@/lib/gmail/sync";
import { log } from "@/lib/log";
import { freshSwitches } from "@/lib/ops-switches";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { backToMailboxes } from "../back";

// Connecting reads the newest emails after the answer, within GMAIL_LIMITS.runBudgetMs.
export const maxDuration = 300;

const kindOf = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

// A token Google handed over a moment ago. If Gmail turns it away, asking Google for another would
// only bring the same answer: the sign-in failed.
const accessWith = (tokens: Tokens): Access => ({
  token: async () => tokens.accessToken,
  renew: async () => {
    throw new GmailSignedOutError();
  },
});

type SignedIn = { tokens: Tokens; address: string; historyId: string } | { failure: string };

// The tokens Google gives for the code, and whose mailbox they are for, as Google says, with the
// place reading starts from. A failure is a code of ours. Until the address is known nothing can be
// ended at Google (ending one permission there ends every one Jane holds for that account, a
// working mailbox's too), so what a failed sign-in brought is dropped.
async function signedIn(
  signIn: Parameters<typeof exchangeCode>[0],
  code: string,
): Promise<SignedIn> {
  try {
    const tokens = await exchangeCode(signIn, code);
    const { address, historyId } = await getProfile(accessWith(tokens));
    return { tokens, address, historyId };
  } catch (error) {
    if (error instanceof GoogleCallError) return { failure: error.code };
    if (error instanceof GmailSignedOutError) return { failure: "signed_out" };
    throw error;
  }
}

// What a sign-in that didn't finish brought, once the address is known: ended at Google only when
// no active mailbox holds that address, this person's own included. Not knowing counts as held.
async function endUnlessHeld(address: string, tokens: Tokens): Promise<void> {
  const held = await heldByAnyone(address).catch(() => true);
  if (!held) await revokeTokens([tokens.refreshToken ?? tokens.accessToken]);
}

// The way back from Google's page. Its path is registered with Google, so it stays. Every answer is
// a fixed status or the mailboxes page with one sealed word: nothing from the address bar is shown
// or stored, and no address, token or code goes into a log, an audit record or the way back.
export async function GET(request: Request) {
  if (!gmailOffered()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const origin = callbackOrigin(request);
  if (!origin) return NextResponse.json({ error: "Not set up" }, { status: 503 });
  const back = (word: NoticeWord) => backToMailboxes(origin, user.id, word);

  // A sign-in begun before reading was paused doesn't finish while it is.
  await freshSwitches();
  if (!gmailOpen()) return back("paused");

  const params = new URL(request.url).searchParams;
  const signIn = matchSignIn((await cookies()).get(SIGN_IN_COOKIE)?.value, {
    userId: user.id,
    state: params.get("state"),
  });
  // Not the sign-in this person started: nothing from the address bar is trusted, or used. Another
  // site can send them here as often as it likes, so this can't end the sign-in they have under way
  // or write security records without end.
  if (!signIn) {
    if (!(await limitOrNull("gmailForgedBack", user.id))) {
      await logAudit(
        { type: "user", id: user.id },
        "gmail_connect_failed",
        { type: "user", id: user.id },
        { user_id: user.id, code: "state" },
      );
    }
    return back("not_connected");
  }

  // From here the sign-in is used up, whichever way it goes.
  const done = (word: NoticeWord) => {
    const response = back(word);
    response.cookies.set(SIGN_IN_COOKIE, "", { path: GMAIL_CALLBACK_PATH, maxAge: 0 });
    return response;
  };
  const failed = async (why: string, word: NoticeWord = "not_connected") => {
    await logAudit(
      { type: "user", id: user.id },
      "gmail_connect_failed",
      { type: "user", id: user.id },
      { user_id: user.id, code: why },
    );
    return done(word);
  };

  const code = params.get("code");
  if (!code) return failed(params.get("error") === "access_denied" ? "denied" : "no_code");
  if (await whyCantConnect(user.id)) return failed("refused");

  const answer = await signedIn(signIn, code);
  if ("failure" in answer) {
    log.error("Gmail sign-in didn't finish", { code: answer.failure });
    // Google's answer doesn't grant read-only access. Asked for alone it has no box to untick, so
    // this isn't the person's choice: the page says Google didn't give the permission.
    return failed(answer.failure, answer.failure === "scope" ? "not_allowed" : "not_connected");
  }
  const { tokens, address, historyId } = answer;
  const saved = await saveMailbox(user.id, {
    address,
    historyId,
    tokens,
    disclosureVersion: signIn.disclosure,
  }).catch((error: unknown) => {
    log.error("Gmail mailbox wasn't saved", { kind: kindOf(error) });
    return null;
  });
  if (!saved) {
    await endUnlessHeld(address, tokens);
    return failed("save");
  }
  // A new address at the cap: nothing was written.
  if ("refused" in saved) {
    await endUnlessHeld(address, tokens);
    return failed("too_many", "too_many");
  }

  const { id, reconnected, tookOver } = saved;
  await logAudit(
    { type: "user", id: user.id },
    "gmail_connected",
    { type: "gmail_mailbox", id },
    { user_id: user.id, reconnected, took_over: tookOver },
  );
  await track(user.id, "gmail_connected", { reconnected, took_over: tookOver });
  // The first read, after the answer. Whatever goes wrong once it holds the mailbox is kept on the
  // row for the page; only the database failing before then lands here.
  after(async () => {
    try {
      await syncMailbox(user.id, id);
    } catch (error) {
      log.error("Gmail first read broke", { kind: kindOf(error) });
    }
  });
  return done(tookOver ? "connected_moved" : "connected");
}
