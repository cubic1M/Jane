import { GMAIL_LIMITS, googleAddressAllowed } from "@/config/gmail";
import { cappedText } from "@/lib/robinhood/capped";

// The one way out to Google for Gmail mailboxes (docs/setup/gmail.md): the sign-in's token calls,
// Gmail's API and the keys that sign its notices all go through call(). It refuses an address that
// isn't one of Google's own, never follows a redirect, lets nothing on the way keep the answer, and
// gives up after a fixed time; jsonOf() reads no more of an answer than its caller allows. A failure leaves as a code of ours, never the
// server's words, which could hold anything. Nothing here logs.

// A call that failed. `code` is ours: a kind or a status, never text from the server.
export class GoogleCallError extends Error {
  constructor(readonly code: string) {
    super(`Google call failed: ${code}`);
    this.name = "GoogleCallError";
  }
}

// Gmail turned the access token away (HTTP 401), and a new one too.
export class GmailSignedOutError extends Error {
  constructor() {
    super("Gmail didn't accept the connection.");
    this.name = "GmailSignedOutError";
  }
}

// Google no longer accepts the refresh token (invalid_grant): the person took Jane's permission
// back or changed their Google password, or it lapsed. Only connecting again helps.
export class GmailGrantGoneError extends Error {
  constructor() {
    super("Google no longer accepts this connection.");
    this.name = "GmailGrantGoneError";
  }
}

// Gmail no longer keeps the history after the place reading had reached (HTTP 404 on history).
export class GmailHistoryGoneError extends Error {
  constructor() {
    super("Gmail no longer has the history from there.");
    this.name = "GmailHistoryGoneError";
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Why no answer came, or why it stopped part way: the kind only.
const kindOf = (error: unknown): string =>
  error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable";

// Google being busy or having trouble, which may have passed a moment later.
const mayPass = (status: number): boolean => status === 429 || status >= 500;

// Lets go of an answer nobody will read, so its connection is free for the next request.
export async function letGo(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Read already, or gone already: nothing is left to hold.
  }
}

// One request to Google. An answer comes back whatever its status, for the caller to judge; no
// answer at all is a GoogleCallError. With `retry`, a request that got no answer, a 429 or a 5xx is
// sent again after a short wait that grows. The sign-in's calls never ask for that: a code works
// once, and a body holding a refresh token or the client's secret isn't sent more than it must be.
export async function call(
  url: string,
  init: RequestInit = {},
  { retry = false }: { retry?: boolean } = {},
): Promise<Response> {
  if (!googleAddressAllowed(url)) throw new GoogleCallError("address_refused");
  const tries = retry ? 1 + GMAIL_LIMITS.callRetries : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        // A redirect could carry a token to another address.
        redirect: "error",
        // Nothing on the way keeps a copy of a person's mail or tokens, whatever it does by default.
        cache: "no-store",
        signal: AbortSignal.timeout(GMAIL_LIMITS.callTimeoutMs),
      });
      if (attempt === tries || !mayPass(response.status)) return response;
      await letGo(response);
    } catch (error) {
      // Timed out, cut off or redirected.
      if (attempt === tries) throw new GoogleCallError(kindOf(error));
    }
    await wait(GMAIL_LIMITS.callRetryWaitMs * attempt);
  }
}

// An answer's JSON, from at most `limitBytes` of it: a huge answer can't fill the memory. Every
// answer Jane asks Google for is a JSON object, so anything else is refused, and an answer that
// stopped part way is a failed call, never an empty answer.
export async function jsonOf(
  response: Response,
  limitBytes: number,
): Promise<Record<string, unknown>> {
  let text: string | null;
  try {
    text = await cappedText(response, limitBytes);
  } catch (error) {
    throw new GoogleCallError(kindOf(error));
  }
  if (text === null) throw new GoogleCallError("too_large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // JSON's own error quotes the text it couldn't read, so it goes no further.
    throw new GoogleCallError("not_json");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new GoogleCallError("not_json");
  }
  return body as Record<string, unknown>;
}
