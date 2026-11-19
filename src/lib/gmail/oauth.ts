import { GMAIL_CALLBACK_PATH, GMAIL_LIMITS, GMAIL_SCOPE, googleServer } from "@/config/gmail";
import { encrypt } from "@/lib/crypto";
import { openSignIn, pkceChallenge, randomValue } from "@/lib/oauth-pkce";
import { siteOrigin } from "@/lib/site-origin";
import { call, GmailGrantGoneError, GoogleCallError, jsonOf, letGo } from "./google";

// Signing in with Google for one Gmail mailbox (docs/setup/gmail.md): the authorization code flow
// with PKCE and state, renewing the access token, and asking Google to end the permission. The
// person signs in on Google's page, so Jane never sees a password. This isn't Jane's own "Sign in
// with Google" and never uses that client. Tokens leave this file only to be encrypted
// (./secrets.ts), and no error thrown here carries one, or the server's words. Nothing here logs.

// Jane's client at Google for Gmail: read from the environment here and nowhere else.
const clientId = (): string => process.env.GMAIL_CLIENT_ID?.trim() ?? "";
const clientSecret = (): string => process.env.GMAIL_CLIENT_SECRET?.trim() ?? "";

// Whether a sign-in can work at all: without both, connecting isn't offered.
export const gmailSetUp = (): boolean => Boolean(clientId() && clientSecret());

export type Tokens = {
  accessToken: string;
  // null when Google sent none. Neither call below hands that on: an exchange without one is
  // refused, and a renewal gives back the one it was given.
  refreshToken: string | null;
  expiresAt: Date | null;
};

// A token, as OAuth defines one: printable, and short enough to save.
const isOAuthValue = (value: unknown): value is string =>
  typeof value === "string" && /^[\x20-\x7e]{1,16384}$/.test(value);
// Past this it isn't a lifetime, and a date from it can't be saved.
const MOST_EXPIRES_IN = 10 * 365 * 24 * 60 * 60;

// The site's own address for the way back: from settings, except on a developer's machine.
export function callbackOrigin(request: Request): string | null {
  const configured =
    siteOrigin() ??
    (URL.canParse(process.env.AUTH_URL ?? "") ? new URL(process.env.AUTH_URL ?? "").origin : null);
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : new URL(request.url).origin;
}

export const SIGN_IN_COOKIE = "jane_gmail_sign_in";
// The key that seals the cookie seals other things too, so the cookie says which it is.
const SIGN_IN_FOR = "gmail_sign_in";

type SignIn = {
  for: typeof SIGN_IN_FOR;
  state: string;
  verifier: string;
  userId: string;
  redirectUri: string;
  // Which words the person was shown before they chose to connect (src/config/gmail-disclosure.ts).
  disclosure: string;
  at: number;
};

// Where to send the person, and what the browser keeps until they come back: encrypted, so the
// verifier stays secret, and naming them, so it only works for the person who started.
export function startSignIn(
  userId: string,
  origin: string,
  disclosure: string,
  { now = new Date() }: { now?: Date } = {},
): { url: string; cookie: string } {
  if (!gmailSetUp()) throw new GoogleCallError("not_set_up");
  const signIn: SignIn = {
    for: SIGN_IN_FOR,
    state: randomValue(),
    verifier: randomValue(),
    userId,
    redirectUri: `${origin}${GMAIL_CALLBACK_PATH}`,
    disclosure,
    at: now.getTime(),
  };
  const url = new URL(googleServer().authorize);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: signIn.redirectUri,
    // Reading only, and asked for alone: with nothing beside it Google shows no box to untick.
    // include_granted_scopes stays out, or the token would also carry whatever else the project
    // was ever granted for that account.
    scope: GMAIL_SCOPE,
    // A refresh token comes only for "offline", and on a second connection only when consent is
    // asked for again. select_account lets a person signed in to several pick the mailbox.
    access_type: "offline",
    prompt: "consent select_account",
    state: signIn.state,
    code_challenge: pkceChallenge(signIn.verifier),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), cookie: encrypt(JSON.stringify(signIn)) };
}

// The sign-in this browser started, if this answer belongs to it: the same person, within the time,
// with the state that went out, and a Gmail sign-in rather than something else sealed with the same
// key. Anything else is null.
export function matchSignIn(
  cookie: string | undefined,
  { userId, state, now = new Date() }: { userId: string; state: string | null; now?: Date },
): SignIn | null {
  let signIn: SignIn | null;
  try {
    signIn = openSignIn<SignIn>(cookie, {
      userId,
      state,
      now: now.getTime(),
      maxAgeMs: GMAIL_LIMITS.signInMinutes * 60 * 1000,
    });
  } catch {
    // It opened, and isn't shaped like a sign-in at all.
    return null;
  }
  const ours =
    signIn?.for === SIGN_IN_FOR &&
    typeof signIn.verifier === "string" &&
    typeof signIn.redirectUri === "string" &&
    typeof signIn.disclosure === "string";
  return ours ? signIn : null;
}

type TokenAnswer = { tokens: Tokens; granted: string[] };

// What the token address says went wrong, in its own one word (RFC 6749, section 5.2), if it says.
// Only ever compared with the words known here: it is never kept.
async function errorNameOf(response: Response): Promise<string | null> {
  try {
    const { error } = await jsonOf(response, GMAIL_LIMITS.signInAnswerBytes);
    return typeof error === "string" ? error : null;
  } catch {
    return null;
  }
}

// One request to the token address, sent once and never again by itself. invalid_grant comes back
// as that word, because what it means depends on what was sent: a spent code, or a permission that
// is gone.
async function tokenRequest(
  fields: Record<string, string>,
  now: Date,
): Promise<TokenAnswer | "invalid_grant"> {
  if (!gmailSetUp()) throw new GoogleCallError("not_set_up");
  const response = await call(googleServer().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      ...fields,
      client_id: clientId(),
      client_secret: clientSecret(),
    }).toString(),
  });
  if (!response.ok) {
    const name = await errorNameOf(response);
    if (name === "invalid_grant") return "invalid_grant";
    // Jane's own client was turned away (a wrong or removed secret): nothing a person can mend by
    // connecting again, so it must never read as their permission being gone.
    if (name === "invalid_client") throw new GoogleCallError("client");
    throw new GoogleCallError(`token_http_${response.status}`);
  }
  let body: Record<string, unknown>;
  try {
    body = await jsonOf(response, GMAIL_LIMITS.signInAnswerBytes);
  } catch (error) {
    // An answer over its limit leaves under a code of this address's own. A renewal runs inside a
    // message fetch (./api.ts), where "too_large" means that one email and makes it a skip: read
    // as that, an email nobody fetched would be passed over.
    if (error instanceof GoogleCallError && error.code === "too_large") {
      throw new GoogleCallError("token_answer");
    }
    throw error;
  }
  const accessToken = body.access_token;
  if (!isOAuthValue(accessToken)) throw new GoogleCallError("token_answer");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  return {
    tokens: {
      accessToken,
      refreshToken: isOAuthValue(body.refresh_token) ? body.refresh_token : null,
      expiresAt:
        expiresIn !== null && expiresIn > 0 && expiresIn <= MOST_EXPIRES_IN
          ? new Date(now.getTime() + expiresIn * 1000)
          : null,
    },
    granted: typeof body.scope === "string" ? body.scope.split(" ") : [],
  };
}

// Trades the code Google sent back for tokens, and checks they are what was asked for. Whatever
// goes wrong, nothing is revoked here: whose mailbox the tokens are for isn't known yet, and at
// Google ending one permission ends every permission the project holds for that account. The
// callback decides, once it knows the address.
export async function exchangeCode(
  signIn: Pick<SignIn, "redirectUri" | "verifier">,
  code: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<Tokens> {
  const answer = await tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: signIn.redirectUri,
      code_verifier: signIn.verifier,
    },
    now,
  );
  // A code that was used already or sat too long: this sign-in failed, and no connection is gone.
  if (answer === "invalid_grant") throw new GoogleCallError("grant");
  // As whole words: a permission whose name only starts or ends like this one is another.
  if (!answer.granted.includes(GMAIL_SCOPE)) throw new GoogleCallError("scope");
  // Without one, the mailbox could be read for an hour and never again.
  if (!answer.tokens.refreshToken) throw new GoogleCallError("no_refresh");
  return answer.tokens;
}

// A new access token. Google keeps the refresh token it gave and seldom sends another, so the one
// in hand comes back with the answer: a caller can save what it gets and lose nothing.
export async function refreshTokens(
  refreshToken: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<Tokens> {
  const answer = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    now,
  );
  if (answer === "invalid_grant") throw new GmailGrantGoneError();
  return { ...answer.tokens, refreshToken: answer.tokens.refreshToken ?? refreshToken };
}

// Asks Google to end the permission these tokens stand for: true only if it took every one. At
// Google that ends every permission the project holds for the account, so the caller asks only
// when no active mailbox holds the address (./mailbox.ts). The token goes in the form's body, never
// in the address, which is what gets written down along the way. Sent once each. Never throws:
// disconnecting and deleting an account can't wait on another company.
export async function revokeTokens(tokens: readonly string[]): Promise<boolean> {
  let done = tokens.length > 0;
  for (const token of tokens) {
    try {
      const response = await call(googleServer().revoke, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
      await letGo(response);
      done &&= response.ok;
    } catch {
      done = false;
    }
  }
  return done;
}
