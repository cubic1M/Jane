import { GMAIL_LIMITS, googleServer } from "@/config/gmail";
import {
  call,
  GmailHistoryGoneError,
  GmailSignedOutError,
  GoogleCallError,
  jsonOf,
  letGo,
} from "./google";

// Gmail's REST calls for one mailbox (docs/setup/gmail.md): its address and place, asking for
// notices, what arrived since a place, the newest messages, and one message. Reading only: the two
// POSTs turn Google's notices on and off and change nothing in the mailbox. The small answers are
// checked for shape here; a message is handed on as it came, for ./message.ts to read. Nothing here
// logs, and no error carries a token or Gmail's words.

// The mailbox's access token for one read: the one in hand, and a way to get the next when Gmail
// turns that one away. Whoever makes it saves what renew() brings.
export type Access = { token(): Promise<string>; renew(): Promise<string> };

// Gmail writes a history id as digits in a string: the number is too large for JSON to carry whole.
const HISTORY_ID = /^\d{1,20}$/;
// Gmail's id for a message: checked only for being safe to put in an address.
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// A time in milliseconds. Past this many digits it isn't one, and a date from it can't be saved.
const MILLISECONDS = /^\d{1,14}$/;
// A mailbox's address, as far as it matters here: one @, no spaces, no longer than one can be.
const ADDRESS = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

// The headers the first look at an email needs (./message.ts): who sent it, what it is about, what
// Google's own check of the sender found, and whether Gmail fetched it from another mailbox.
const FIRST_LOOK_HEADERS = ["From", "Subject", "Authentication-Results", "X-Gmail-Fetch-Info"];

// Gmail's own words for "too many requests" when it answers 403 rather than 429.
const LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"]);

const fieldsOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

// A number Gmail sends as digits in a string, as those digits. A plain number is taken too, while
// it is one JSON carries whole.
function digitsOf(value: unknown, shape: RegExp): string {
  const digits =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  if (typeof digits !== "string" || !shape.test(digits)) throw new GoogleCallError("shape");
  return digits;
}

// One request with the mailbox's token. Gmail turning the token away may only mean it ran out
// early, so one new token is tried, on this one call. A second refusal is Gmail's trouble, and never
// by itself a reason to make the person connect again: only renew() finding the permission gone is.
async function ask(access: Access, url: string, posted?: object): Promise<Response> {
  const send = (token: string) =>
    call(
      url,
      {
        method: posted ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(posted ? { "Content-Type": "application/json" } : {}),
        },
        ...(posted ? { body: JSON.stringify(posted) } : {}),
      },
      { retry: true },
    );
  const first = await send(await access.token());
  if (first.status !== 401) return first;
  await letGo(first);
  const second = await send(await access.renew());
  if (second.status !== 401) return second;
  await letGo(second);
  throw new GmailSignedOutError();
}

async function saysLimit(response: Response): Promise<boolean> {
  try {
    const { errors } = fieldsOf((await jsonOf(response, GMAIL_LIMITS.answerBytes)).error);
    return (
      Array.isArray(errors) &&
      errors.some((one: unknown) => {
        const { reason } = fieldsOf(one);
        return typeof reason === "string" && LIMIT_REASONS.has(reason);
      })
    );
  } catch {
    return false;
  }
}

// An answer that isn't the one asked for, as a code of ours. By now a 429 has had its retries.
async function refusal(response: Response): Promise<GoogleCallError> {
  const limited =
    response.status === 429 || (response.status === 403 && (await saysLimit(response)));
  await letGo(response);
  return new GoogleCallError(limited ? "rate_limited" : `http_${response.status}`);
}

async function answerOf(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw await refusal(response);
  return jsonOf(response, GMAIL_LIMITS.answerBytes);
}

// Whose mailbox the tokens are for, as Google says, and the place reading starts from.
export async function getProfile(access: Access): Promise<{ address: string; historyId: string }> {
  const body = await answerOf(await ask(access, `${googleServer().api}/profile`));
  const address = typeof body.emailAddress === "string" ? body.emailAddress.toLowerCase() : "";
  if (!ADDRESS.test(address)) throw new GoogleCallError("shape");
  return { address, historyId: digitsOf(body.historyId, HISTORY_ID) };
}

// Asks Gmail to send word to the topic when mail reaches the inbox, for a week or until asked
// again. Only the inbox: a draft would otherwise send a notice every time it is saved.
export async function watch(
  access: Access,
  topic: string,
): Promise<{ historyId: string; expiresAt: Date }> {
  const body = await answerOf(
    await ask(access, `${googleServer().api}/watch`, {
      topicName: topic,
      labelIds: ["INBOX"],
      labelFilterBehavior: "include",
    }),
  );
  return {
    historyId: digitsOf(body.historyId, HISTORY_ID),
    expiresAt: new Date(Number(digitsOf(body.expiration, MILLISECONDS))),
  };
}

// Asks Gmail to stop sending word of new mail. Best effort, with the token as it is and sent once:
// the mailbox is being removed, and a notice that still arrives finds nothing to read. Never throws.
export async function stopWatch(accessToken: string): Promise<boolean> {
  try {
    const response = await call(`${googleServer().api}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    await letGo(response);
    return response.ok;
  } catch {
    return false;
  }
}

// A message a history record says arrived. Its labels are null when the record didn't give them,
// which is not the same as having none.
function addedOf(entry: unknown): { id: string; labelIds: string[] | null } {
  const { id, labelIds } = fieldsOf(fieldsOf(entry).message);
  if (typeof id !== "string" || !id) throw new GoogleCallError("shape");
  const labelled =
    Array.isArray(labelIds) &&
    labelIds.every((label): label is string => typeof label === "string");
  return { id, labelIds: labelled ? labelIds : null };
}

// One page of what arrived after a place, oldest first, and the mailbox's newest place. A place
// Gmail no longer keeps is GmailHistoryGoneError. A place that isn't digits is refused before
// anything is sent (GoogleCallError "bad_id").
export async function listHistory(
  access: Access,
  startHistoryId: string,
  pageToken: string | null,
): Promise<{
  records: { id: string; added: { id: string; labelIds: string[] | null }[] }[];
  nextPageToken: string | null;
  historyId: string;
}> {
  if (!HISTORY_ID.test(startHistoryId)) throw new GoogleCallError("bad_id");
  const query = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" });
  if (pageToken) query.set("pageToken", pageToken);
  const response = await ask(access, `${googleServer().api}/history?${query}`);
  if (response.status === 404) {
    await letGo(response);
    throw new GmailHistoryGoneError();
  }
  const body = await answerOf(response);
  const history = body.history ?? [];
  const next = body.nextPageToken ?? null;
  // A page token that can't be used would end the listing early, and mail after it would be lost.
  if (!Array.isArray(history) || (next !== null && (typeof next !== "string" || !next))) {
    throw new GoogleCallError("shape");
  }
  return {
    records: history.map((entry: unknown) => {
      const { id, messagesAdded } = fieldsOf(entry);
      const added = Array.isArray(messagesAdded) ? messagesAdded : [];
      return { id: digitsOf(id, HISTORY_ID), added: added.map(addedOf) };
    }),
    nextPageToken: next,
    historyId: digitsOf(body.historyId, HISTORY_ID),
  };
}

// The ids of the newest messages from the last `days` days, newest first as Gmail lists them, at
// most `most`: not advertising, social or forum mail, and nothing the person wrote themselves.
export async function listRecent(
  access: Access,
  { days, most }: { days: number; most: number },
): Promise<string[]> {
  const query = new URLSearchParams({
    q: `newer_than:${days}d -category:promotions -category:social -category:forums -in:sent -in:drafts`,
    maxResults: String(most),
  });
  const body = await answerOf(await ask(access, `${googleServer().api}/messages?${query}`));
  const messages = body.messages ?? [];
  if (!Array.isArray(messages)) throw new GoogleCallError("shape");
  return messages.slice(0, most).map((entry: unknown) => {
    const { id } = fieldsOf(entry);
    if (typeof id !== "string" || !id) throw new GoogleCallError("shape");
    return id;
  });
}

// One message as Gmail sends it, or null when it is gone. "metadata" asks for the few headers the
// first look needs and no body; "full" brings the body too. Nothing in it is read here. An id that
// isn't shaped like one is refused before anything is sent (GoogleCallError "bad_id"); that, an
// answer too large to take ("too_large") and a 400 ("http_400") belong to this one message, and
// every other failure to the mailbox or to Google.
export async function getMessage(
  access: Access,
  id: string,
  format: "metadata" | "full",
): Promise<Record<string, unknown> | null> {
  if (!MESSAGE_ID.test(id)) throw new GoogleCallError("bad_id");
  const query = new URLSearchParams({ format });
  if (format === "metadata") {
    for (const name of FIRST_LOOK_HEADERS) query.append("metadataHeaders", name);
  }
  const response = await ask(
    access,
    `${googleServer().api}/messages/${encodeURIComponent(id)}?${query}`,
  );
  if (response.status === 404) {
    await letGo(response);
    return null;
  }
  return answerOf(response);
}
