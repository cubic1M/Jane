import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS, googleServer } from "@/config/gmail";
import { FakeGoogle, fakeMessage, gmailError } from "./__fixtures__/fake-google";
import {
  getMessage,
  getProfile,
  listHistory,
  listRecent,
  stopWatch,
  watch,
  type Access,
} from "./api";
import {
  GmailGrantGoneError,
  GmailHistoryGoneError,
  GmailSignedOutError,
  GoogleCallError,
} from "./google";
import { refreshTokens } from "./oauth";

// Gmail's calls against the fake Google: what each asks for and gives back, what it does when the
// token is turned away or Gmail is busy, and what it refuses to send or to take.

// The same limits, without the wait between tries.
vi.mock("@/config/gmail", async (original) => {
  const real = await original<typeof import("@/config/gmail")>();
  return { ...real, GMAIL_LIMITS: { ...real.GMAIL_LIMITS, callRetryWaitMs: 1 } };
});

const TOPIC = "projects/jane-mail/topics/gmail";
const TRIES = 1 + GMAIL_LIMITS.callRetries;

const thrownBy = (work: Promise<unknown>): Promise<unknown> =>
  work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
async function codeOf(work: Promise<unknown>): Promise<string> {
  const error = await thrownBy(work);
  expect(error).toBeInstanceOf(GoogleCallError);
  return (error as GoogleCallError).code;
}
const fieldsOf = (value: unknown) => value as Record<string, unknown>;

let fake: FakeGoogle;
let access: Access;
let renew: ReturnType<typeof vi.fn<() => Promise<string>>>;
let firstToken: string;

beforeEach(async () => {
  fake = await new FakeGoogle().start();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("GMAIL_API_URL", fake.origin);
  vi.stubEnv("GMAIL_CLIENT_ID", fake.clientId);
  vi.stubEnv("GMAIL_CLIENT_SECRET", fake.clientSecret);
  // What a read holds: the mailbox's token, and a renewal that asks Google for the next one.
  const tokens = fake.issueTokensForTest();
  firstToken = tokens.accessToken;
  let current = tokens.accessToken;
  renew = vi.fn(async () => {
    current = (await refreshTokens(tokens.refreshToken)).accessToken;
    return current;
  });
  access = { token: async () => current, renew };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fake.stop();
});

const box = () => fake.mailbox();
const to = (path: string) => fake.requests.filter((request) => request.path.endsWith(path));
const statuses = () => fake.requests.map((request) => request.status);
const queryOf = (path: string) => new URLSearchParams(to(path)[0]?.query);

describe("the mailbox's address and place", () => {
  it("gives the address and the place as Gmail's digits", async () => {
    expect(await getProfile(access)).toEqual({
      address: fake.options.address,
      historyId: box().historyId,
    });
    // The fake's places are past what a JavaScript number holds: they stay text.
    expect(BigInt(box().historyId) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("gives the address in small letters, however Google writes it", async () => {
    const tokens = fake.issueTokensForTest("Some.Person@Fake-Mailbox.TEST");
    const theirs: Access = { token: async () => tokens.accessToken, renew };
    expect((await getProfile(theirs)).address).toBe("some.person@fake-mailbox.test");
  });

  it("sends the token in a header and nothing in the address", async () => {
    await getProfile(access);
    expect(fake.requests).toMatchObject([
      { method: "GET", path: "/gmail/v1/users/me/profile", query: "", bearer: firstToken },
    ]);
  });

  it.each([
    ["no address", { historyId: "12" }],
    ["an address that isn't text", { emailAddress: 5, historyId: "12" }],
    ["an address with no @", { emailAddress: "someone.example", historyId: "12" }],
    ["an address with two", { emailAddress: "a@b@c.example", historyId: "12" }],
    ["an address with a space", { emailAddress: "a b@c.example", historyId: "12" }],
    ["an address with a line break", { emailAddress: "a@c.example\nBcc: x", historyId: "12" }],
    ["an address far too long", { emailAddress: `${"a".repeat(65)}@c.example`, historyId: "12" }],
    ["no place", { emailAddress: "a@c.example" }],
    ["a place that isn't digits", { emailAddress: "a@c.example", historyId: "12a" }],
    ["a place below zero", { emailAddress: "a@c.example", historyId: -1 }],
    ["a place with a fraction", { emailAddress: "a@c.example", historyId: 1.5 }],
    ["a place too long to be one", { emailAddress: "a@c.example", historyId: "1".repeat(21) }],
    [
      "a number too large to have arrived whole",
      { emailAddress: "a@c.example", historyId: 2 ** 60 },
    ],
  ])("refuses an answer with %s", async (_what, body) => {
    fake.answerWith("/profile", 200, { body });
    expect(await codeOf(getProfile(access))).toBe("shape");
  });

  it("takes a place sent as a plain number, while it is one JSON carries whole", async () => {
    fake.answerWith("/profile", 200, { body: { emailAddress: "A@C.example", historyId: 123456 } });
    expect(await getProfile(access)).toEqual({ address: "a@c.example", historyId: "123456" });
  });
});

describe("asking for notices", () => {
  it("asks for the inbox only, and gives the place and when the notices end", async () => {
    fake.options.watchExpiresAt = new Date("2026-11-25T12:00:00.123Z");
    expect(await watch(access, TOPIC)).toEqual({
      historyId: box().historyId,
      expiresAt: new Date("2026-11-25T12:00:00.123Z"),
    });
    expect(to("/watch")).toMatchObject([
      {
        method: "POST",
        query: "",
        bearer: firstToken,
        json: { topicName: TOPIC, labelIds: ["INBOX"], labelFilterBehavior: "include" },
      },
    ]);
    expect(box().watch).toMatchObject({ topicName: TOPIC });
  });

  it("reads both numbers from text, which is how Gmail sends them", async () => {
    await watch(access, TOPIC);
    const answered = await (
      await fetch(`${googleServer().api}/watch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${firstToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ topicName: TOPIC }),
      })
    ).json();
    expect(answered).toEqual({
      historyId: expect.stringMatching(/^\d+$/),
      expiration: expect.stringMatching(/^\d+$/),
    });
  });

  it.each([
    ["no end", { historyId: "12" }],
    ["an end that isn't a time", { historyId: "12", expiration: "next week" }],
    ["an end too far off to be one", { historyId: "12", expiration: "1".repeat(15) }],
    ["an end below zero", { historyId: "12", expiration: -5 }],
    ["no place", { expiration: "1795000000000" }],
  ])("refuses an answer with %s", async (_what, body) => {
    fake.answerWith("/watch", 200, { body });
    expect(await codeOf(watch(access, TOPIC))).toBe("shape");
  });

  it("gives a code of ours when Gmail won't", async () => {
    expect(await codeOf(watch(access, "not a topic"))).toBe("http_400");
    fake.answerWith("/watch", 403);
    expect(await codeOf(watch(access, TOPIC))).toBe("http_403");
  });
});

describe("stopping notices", () => {
  it("asks Gmail to stop, with the token it is given", async () => {
    await watch(access, TOPIC);
    expect(await stopWatch(firstToken)).toBe(true);
    expect(fake.stopped).toEqual([fake.options.address]);
    expect(box().watch).toBeNull();
    expect(to("/stop")).toMatchObject([{ method: "POST", query: "", bearer: firstToken }]);
  });

  it("is false, with no new token asked for, when Gmail doesn't take the token", async () => {
    expect(await stopWatch("never-a-token")).toBe(false);
    fake.expireAccessTokens();
    expect(await stopWatch(firstToken)).toBe(false);
    expect(to("/token")).toEqual([]);
    expect(fake.stopped).toEqual([]);
  });

  it("asks once, even when Gmail is having trouble", async () => {
    fake.answerWith("/stop", 503, { times: 5 });
    expect(await stopWatch(firstToken)).toBe(false);
    expect(to("/stop")).toHaveLength(1);
  });

  it("never throws: not for a redirect, a cut connection or a server that is gone", async () => {
    fake.options.redirectTo = "https://evil.example/steal";
    expect(await stopWatch(firstToken)).toBe(false);
    fake.options.redirectTo = undefined;
    fake.hangUp("/stop");
    expect(await stopWatch(firstToken)).toBe(false);
    await fake.stop();
    expect(await stopWatch(firstToken)).toBe(false);
  });
});

describe("what arrived since a place", () => {
  it("lists the records after it, oldest first, with each message and its labels", async () => {
    const start = box().historyId;
    const receipt = box().deliver({ labelIds: ["INBOX", "CATEGORY_UPDATES"] });
    const [bill, advert] = box().deliverTogether([
      { labelIds: ["INBOX"] },
      { labelIds: ["CATEGORY_PROMOTIONS"] },
    ]);
    const unlabelled = box().deliver({}, { labels: false });
    const page = await listHistory(access, start, null);
    expect(page.records).toEqual([
      {
        id: String(BigInt(start) + BigInt(1)),
        added: [{ id: receipt.id, labelIds: ["INBOX", "CATEGORY_UPDATES"] }],
      },
      {
        id: String(BigInt(start) + BigInt(2)),
        added: [
          { id: bill.id, labelIds: ["INBOX"] },
          { id: advert.id, labelIds: ["CATEGORY_PROMOTIONS"] },
        ],
      },
      // Labels the record didn't give are unknown, which isn't the same as none.
      { id: String(BigInt(start) + BigInt(3)), added: [{ id: unlabelled.id, labelIds: null }] },
    ]);
    expect(page.nextPageToken).toBeNull();
    expect(page.historyId).toBe(box().historyId);
  });

  it("asks for arrivals only, after the place it is given", async () => {
    const start = box().historyId;
    await listHistory(access, start, null);
    expect(Object.fromEntries(queryOf("/history"))).toEqual({
      startHistoryId: start,
      historyTypes: "messageAdded",
    });
  });

  it("gives nothing after the place itself: the place is not read twice", async () => {
    box().deliver();
    expect((await listHistory(access, box().historyId, null)).records).toEqual([]);
  });

  it("gives the mailbox's newest place, which can be past the last record", async () => {
    const start = box().historyId;
    box().deliver();
    box().bump();
    const page = await listHistory(access, start, null);
    expect(page.records).toHaveLength(1);
    expect(BigInt(page.historyId) > BigInt(page.records[0].id)).toBe(true);
  });

  it("follows pages, and sees mail that arrives between one page and the next", async () => {
    fake.options.historyPageSize = 2;
    const start = box().historyId;
    const sent = [box().deliver(), box().deliver(), box().deliver()].map((message) => message.id);
    const first = await listHistory(access, start, null);
    expect(first.records.flatMap((record) => record.added).map((added) => added.id)).toEqual(
      sent.slice(0, 2),
    );
    expect(first.nextPageToken).toBeTruthy();
    const late = box().deliver().id;
    const second = await listHistory(access, start, first.nextPageToken);
    expect(second.records.flatMap((record) => record.added).map((added) => added.id)).toEqual([
      sent[2],
      late,
    ]);
    expect(second.nextPageToken).toBeNull();
    expect(BigInt(second.historyId) > BigInt(first.historyId)).toBe(true);
    expect(new URLSearchParams(to("/history")[1].query).get("pageToken")).toBe(first.nextPageToken);
  });

  it("says so when Gmail no longer keeps the history from that place", async () => {
    const start = box().historyId;
    box().deliver();
    box().loseHistory();
    expect(await thrownBy(listHistory(access, start, null))).toBeInstanceOf(GmailHistoryGoneError);
    // Asked once: a place that is gone won't come back.
    expect(to("/history")).toHaveLength(1);
    expect((await listHistory(access, box().historyId, null)).records).toEqual([]);
  });

  it.each([
    "",
    "abc",
    "12 34",
    "12&historyTypes=labelAdded",
    "1/../../profile",
    "-1",
    "1e5",
    "1.5",
    "٣٤",
    "0x1f",
    "1".repeat(21),
    "planted-marker-text",
  ])("refuses the place %j before anything is sent", async (place) => {
    expect(await codeOf(listHistory(access, place, null))).toBe("bad_id");
    expect(fake.requests).toEqual([]);
  });

  it.each([
    ["a history that isn't a list", { history: { id: "5" }, historyId: "9" }],
    ["a record whose id isn't digits", { history: [{ id: "abc" }], historyId: "9" }],
    ["a record with no id", { history: [{ messagesAdded: [] }], historyId: "9" }],
    ["a record that isn't one", { history: ["5"], historyId: "9" }],
    [
      "an arrival with no message id",
      { history: [{ id: "5", messagesAdded: [{ message: { threadId: "t" } }] }], historyId: "9" },
    ],
    [
      "an arrival whose id isn't text",
      { history: [{ id: "5", messagesAdded: [{ message: { id: 7 } }] }], historyId: "9" },
    ],
    ["a next page that isn't text", { history: [], nextPageToken: 5, historyId: "9" }],
    ["an empty next page", { history: [], nextPageToken: "", historyId: "9" }],
    ["no newest place", { history: [] }],
  ])("refuses an answer with %s", async (_what, body) => {
    fake.answerWith("/history", 200, { body });
    expect(await codeOf(listHistory(access, "4", null))).toBe("shape");
  });

  it("takes a record that names no arrivals, and labels it can't read as unknown", async () => {
    fake.answerWith("/history", 200, {
      body: {
        history: [
          { id: "5" },
          { id: "6", messagesAdded: "none" },
          { id: "7", messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX", 5] } }] },
          { id: "8", messagesAdded: [{ message: { id: "m2", labelIds: "INBOX" } }] },
        ],
        historyId: "9",
      },
    });
    expect((await listHistory(access, "4", null)).records).toEqual([
      { id: "5", added: [] },
      { id: "6", added: [] },
      { id: "7", added: [{ id: "m1", labelIds: null }] },
      { id: "8", added: [{ id: "m2", labelIds: null }] },
    ]);
  });
});

describe("the newest messages", () => {
  const look = () =>
    listRecent(access, { days: GMAIL_LIMITS.lookBackDays, most: GMAIL_LIMITS.lookBackMessages });

  it("asks with the design's query, for at most the number wanted", async () => {
    await look();
    expect(Object.fromEntries(queryOf("/messages"))).toEqual({
      q: "newer_than:14d -category:promotions -category:social -category:forums -in:sent -in:drafts",
      maxResults: "30",
    });
  });

  it("gives the ids newest first, without the mail the query leaves out", async () => {
    const older = box().deliver({ labelIds: ["INBOX", "CATEGORY_UPDATES"] });
    for (const label of [
      "CATEGORY_PROMOTIONS",
      "CATEGORY_SOCIAL",
      "CATEGORY_FORUMS",
      "SENT",
      "DRAFT",
      "SPAM",
      "TRASH",
    ]) {
      box().deliver({ labelIds: [label] });
    }
    const newer = box().deliver({ labelIds: ["INBOX"] });
    expect(await look()).toEqual([newer.id, older.id]);
  });

  it("leaves out mail older than the days asked for", async () => {
    const now = new Date("2026-11-18T12:00:00Z");
    fake.options.now = now;
    const day = 24 * 60 * 60 * 1000;
    const recent = box().deliver({ receivedAt: new Date(now.getTime() - 13 * day) });
    box().deliver({ receivedAt: new Date(now.getTime() - 15 * day) });
    expect(await look()).toEqual([recent.id]);
  });

  it("gives no more than the number wanted, even if Gmail sends more", async () => {
    const sent = [box().deliver(), box().deliver(), box().deliver()].map((message) => message.id);
    expect(await listRecent(access, { days: 14, most: 2 })).toEqual([sent[2], sent[1]]);
    fake.answerWith("/messages", 200, {
      body: { messages: ["a", "b", "c"].map((id) => ({ id, threadId: id })) },
    });
    expect(await listRecent(access, { days: 14, most: 2 })).toEqual(["a", "b"]);
  });

  it("gives an empty list for a mailbox with nothing recent", async () => {
    expect(await look()).toEqual([]);
  });

  it.each([
    ["messages that aren't a list", { messages: "none" }],
    ["a message with no id", { messages: [{ threadId: "t" }] }],
    ["a message that isn't one", { messages: ["m1"] }],
  ])("refuses an answer with %s", async (_what, body) => {
    fake.answerWith("/messages", 200, { body });
    expect(await codeOf(look())).toBe("shape");
  });
});

describe("one message", () => {
  const namesOf = (message: unknown): string[] =>
    (fieldsOf(fieldsOf(message).payload).headers as { name: string }[]).map(({ name }) => name);

  it("asks first for the four headers the first look needs, and gets no body", async () => {
    const sent = box().deliver({
      text: "Total: $42.10",
      html: "<p>Total: $42.10</p>",
      headers: [{ name: "X-Gmail-Fetch-Info", value: "someone@other.example 1 pop.other.example" }],
    });
    const message = await getMessage(access, sent.id, "metadata");
    const query = queryOf(`/messages/${sent.id}`);
    expect(query.get("format")).toBe("metadata");
    expect(query.getAll("metadataHeaders")).toEqual([
      "From",
      "Subject",
      "Authentication-Results",
      "X-Gmail-Fetch-Info",
    ]);
    // The fake holds more headers, among them one whose name only ends like Google's check.
    expect(namesOf(sent)).toContain("ARC-Authentication-Results");
    expect(namesOf(sent)).toContain("Delivered-To");
    expect(namesOf(message).sort()).toEqual([
      "Authentication-Results",
      "From",
      "Subject",
      "X-Gmail-Fetch-Info",
    ]);
    expect(message).toMatchObject({
      id: sent.id,
      labelIds: sent.labelIds,
      snippet: "Total: $42.10",
      internalDate: sent.internalDate,
      sizeEstimate: sent.sizeEstimate,
    });
    expect(JSON.stringify(message)).not.toContain('"parts"');
    expect(JSON.stringify(message)).not.toContain('"data"');
  });

  it("brings the whole message, as it came, when asked for it in full", async () => {
    const sent = box().deliver({
      text: "Total: $42.10",
      html: "<p>Total: <b>$42.10</b></p>",
      attachment: "receipt.pdf",
    });
    expect(await getMessage(access, sent.id, "full")).toEqual(sent);
    expect(Object.fromEntries(queryOf(`/messages/${sent.id}`))).toEqual({ format: "full" });
    expect(fake.fetched("full")).toEqual([sent.id]);
    expect(fake.fetched("metadata")).toEqual([]);
  });

  it("hands on a message without its arrival time as it is", async () => {
    const sent = box().deliver({ receivedAt: null, sizeEstimate: null });
    const message = fieldsOf(await getMessage(access, sent.id, "metadata"));
    expect("internalDate" in message).toBe(false);
    expect("sizeEstimate" in message).toBe(false);
  });

  it("gives null for a message that is gone", async () => {
    const sent = box().deliver();
    box().remove(sent.id);
    expect(await getMessage(access, sent.id, "metadata")).toBeNull();
    expect(await getMessage(access, "0123456789abcdef", "full")).toBeNull();
    // Asked once each: a message that is gone won't come back.
    expect(statuses()).toEqual([404, 404]);
  });

  it.each([
    "",
    "../profile",
    "a/b",
    "a?format=raw",
    "a%2Fb",
    "a b",
    "a\nb",
    "ünï",
    "a.b",
    "x".repeat(65),
  ])("refuses the id %j before anything is sent", async (id) => {
    expect(await codeOf(getMessage(access, id, "metadata"))).toBe("bad_id");
    expect(await codeOf(getMessage(access, id, "full"))).toBe("bad_id");
    expect(fake.requests).toEqual([]);
  });

  it("refuses an answer larger than it may take, and still reads the next message", async () => {
    const huge = box().deliver({ text: "x".repeat(GMAIL_LIMITS.answerBytes) });
    const next = box().deliver();
    expect(await codeOf(getMessage(access, huge.id, "full"))).toBe("too_large");
    expect(fieldsOf(await getMessage(access, huge.id, "metadata")).id).toBe(huge.id);
    expect(fieldsOf(await getMessage(access, next.id, "full")).id).toBe(next.id);
  });

  it("gives a code of ours for a request Gmail calls bad", async () => {
    const sent = box().deliver();
    fake.answerWith(`/messages/${sent.id}`, 400);
    expect(await codeOf(getMessage(access, sent.id, "full"))).toBe("http_400");
    expect(to(`/messages/${sent.id}`)).toHaveLength(1);
  });

  // A page that isn't JSON came from something on the way, not from the email: skipping the
  // email for it would lose mail to an outage.
  it("fails, rather than give an empty message, when the answer isn't a JSON object", async () => {
    const sent = box().deliver();
    fake.answerWith(`/messages/${sent.id}`, 200, { body: "<html>Bad Gateway</html>" });
    expect(await codeOf(getMessage(access, sent.id, "full"))).toBe("not_json");
  });
});

describe("when Gmail turns the token away", () => {
  it("never asks for a new token while the one in hand works", async () => {
    await getProfile(access);
    await listRecent(access, { days: 14, most: 5 });
    expect(renew).not.toHaveBeenCalled();
  });

  it("gets one new token and repeats that one call with it", async () => {
    fake.expireAccessTokens();
    expect((await getProfile(access)).address).toBe(fake.options.address);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(fake.requests.map(({ path, status }) => [path, status])).toEqual([
      ["/gmail/v1/users/me/profile", 401],
      ["/token", 200],
      ["/gmail/v1/users/me/profile", 200],
    ]);
    const [refused, , taken] = fake.requests;
    expect(refused.bearer).toBe(firstToken);
    expect(taken.bearer).toMatch(/^fake-access-/);
    expect(taken.bearer).not.toBe(firstToken);
    // The next call uses the new one straight away.
    await getProfile(access);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("repeats a request that carried a body with the same body", async () => {
    fake.expireAccessTokens();
    await watch(access, TOPIC);
    expect(to("/watch").map(({ status, json }) => [status, fieldsOf(json).topicName])).toEqual([
      [401, TOPIC],
      [200, TOPIC],
    ]);
  });

  // Renewing worked, so the permission stands: a new token turned away is Gmail's trouble, and
  // not a reason to make the person connect again.
  it("calls a second refusal signed out, with no third try and no second renewal", async () => {
    fake.answerWith("/profile", 401, { times: 5 });
    const error = await thrownBy(getProfile(access));
    expect(error).toBeInstanceOf(GmailSignedOutError);
    expect(error).not.toBeInstanceOf(GmailGrantGoneError);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(to("/profile")).toHaveLength(2);
  });

  it("lets the permission being gone through, when renewing finds it so", async () => {
    fake.takeBack();
    expect(await thrownBy(getProfile(access))).toBeInstanceOf(GmailGrantGoneError);
    expect(to("/profile")).toHaveLength(1);
  });

  it("lets a renewal that failed through as it is", async () => {
    fake.expireAccessTokens();
    fake.answerWith("/token", 500);
    expect(await codeOf(getProfile(access))).toBe("token_http_500");
    expect(to("/profile")).toHaveLength(1);
  });

  it("does the same for every read", async () => {
    const sent = box().deliver();
    const start = box().historyId;
    const reads: [string, () => Promise<unknown>][] = [
      ["/profile", () => getProfile(access)],
      ["/watch", () => watch(access, TOPIC)],
      ["/history", () => listHistory(access, start, null)],
      ["/messages", () => listRecent(access, { days: 14, most: 5 })],
      [`/messages/${sent.id}`, () => getMessage(access, sent.id, "metadata")],
    ];
    for (const [path, read] of reads) {
      fake.expireAccessTokens();
      await read();
      expect(
        to(path).map((request) => request.status),
        path,
      ).toEqual([401, 200]);
    }
    expect(renew).toHaveBeenCalledTimes(reads.length);
  });
});

describe("when Gmail is busy or broken", () => {
  it("tries again after a 500, and reads the good answer", async () => {
    fake.answerWith("/profile", 500);
    expect((await getProfile(access)).historyId).toBe(box().historyId);
    expect(statuses()).toEqual([500, 200]);
    expect(renew).not.toHaveBeenCalled();
  });

  it("does so for every read", async () => {
    const sent = box().deliver();
    const start = box().historyId;
    const reads: [string, () => Promise<unknown>][] = [
      ["/watch", () => watch(access, TOPIC)],
      ["/history", () => listHistory(access, start, null)],
      ["/messages", () => listRecent(access, { days: 14, most: 5 })],
      [`/messages/${sent.id}`, () => getMessage(access, sent.id, "full")],
    ];
    for (const [path, read] of reads) {
      fake.answerWith(path, 503);
      await read();
      expect(
        to(path).map((request) => request.status),
        path,
      ).toEqual([503, 200]);
    }
  });

  it("ends as a code of ours when it stays broken", async () => {
    const sent = box().deliver();
    fake.answerWith(`/messages/${sent.id}`, 503, { times: 10 });
    expect(await codeOf(getMessage(access, sent.id, "full"))).toBe("http_503");
    expect(to(`/messages/${sent.id}`)).toHaveLength(TRIES);
  });

  it("ends as unreachable when no answer comes", async () => {
    fake.hangUp("/history", 10);
    expect(await codeOf(listHistory(access, box().historyId, null))).toBe("unreachable");
    expect(to("/history")).toHaveLength(TRIES);
  });

  it("calls a 429 that stays the rate limit", async () => {
    fake.answerWith("/history", 429, { times: 10 });
    expect(await codeOf(listHistory(access, box().historyId, null))).toBe("rate_limited");
    expect(to("/history")).toHaveLength(TRIES);
  });

  it.each(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"])(
    "calls a 403 that says %s the rate limit",
    async (reason) => {
      fake.answerWith("/profile", 403, { body: gmailError(403, reason) });
      expect(await codeOf(getProfile(access))).toBe("rate_limited");
    },
  );

  it.each([
    ["another reason", gmailError(403, "insufficientPermissions")],
    ["a reason that only reads alike", gmailError(403, "rateLimitExceededNot")],
    ["no reason", { error: { code: 403, message: "rateLimitExceeded" } }],
    ["reasons that aren't a list", { error: { errors: "rateLimitExceeded" } }],
    ["text that isn't JSON", "userRateLimitExceeded"],
  ])("doesn't call a 403 with %s the rate limit", async (_what, body) => {
    fake.answerWith("/profile", 403, { body });
    expect(await codeOf(getProfile(access))).toBe("http_403");
  });

  it("never follows a redirect from Gmail, which could carry the token off", async () => {
    const other = await new FakeGoogle().start();
    try {
      const sent = box().deliver();
      fake.options.redirectTo = `${other.origin}/steal`;
      expect(await codeOf(getProfile(access))).toBe("unreachable");
      expect(await codeOf(getMessage(access, sent.id, "full"))).toBe("unreachable");
      expect(other.requests).toEqual([]);
    } finally {
      await other.stop();
    }
  });
});

describe("what an error may carry", () => {
  // The fake's error answers repeat the token they were sent.
  it("is none of Gmail's words and no token", async () => {
    const sent = box().deliver();
    fake.answerWith("/profile", 500, { times: TRIES });
    fake.answerWith("/history", 403);
    fake.answerWith(`/messages/${sent.id}`, 429, { times: TRIES });
    const errors = [
      await thrownBy(getProfile(access)),
      await thrownBy(listHistory(access, "1", null)),
      await thrownBy(getMessage(access, sent.id, "full")),
      await thrownBy(listHistory(access, "not digits", null)),
    ];
    fake.answerWith("/profile", 401, { times: 10 });
    errors.push(await thrownBy(getProfile(access)));
    expect(errors.map(String)).toEqual([
      "GoogleCallError: Google call failed: http_500",
      "GoogleCallError: Google call failed: http_403",
      "GoogleCallError: Google call failed: rate_limited",
      "GoogleCallError: Google call failed: bad_id",
      "GmailSignedOutError: Gmail didn't accept the connection.",
    ]);
    for (const error of errors) {
      const said = `${JSON.stringify(error)} ${(error as Error).stack}`;
      expect(said).not.toContain("fake-access-");
      expect(said).not.toMatch(/backendError|forbidden|rateLimitExceeded|authError/);
    }
  });
});

// What later tests build their mail with: shaped as Gmail's API sends a message.
describe("the fake's own mail", () => {
  type Part = { mimeType: string; filename: string; body: { data?: string }; parts?: Part[] };
  const textOf = (part: Part) => Buffer.from(part.body.data ?? "", "base64url").toString("utf8");

  it("nests the bodies as base64url parts, plain and HTML, beside a file", () => {
    const message = fakeMessage({
      text: "Total: $42.10 — thank you",
      html: "<p>Total: <b>$42.10</b></p>",
      attachment: "receipt.pdf",
    });
    const payload = message.payload as Part;
    expect(payload.mimeType).toBe("multipart/mixed");
    const [bodies, file] = payload.parts ?? [];
    expect(bodies.mimeType).toBe("multipart/alternative");
    expect((bodies.parts ?? []).map((part) => [part.mimeType, textOf(part)])).toEqual([
      ["text/plain", "Total: $42.10 — thank you"],
      ["text/html", "<p>Total: <b>$42.10</b></p>"],
    ]);
    expect(file.filename).toBe("receipt.pdf");
    expect(file.body.data).toBeUndefined();
  });

  it("is one plain part when that is all there is, with Google's check passing by default", () => {
    const message = fakeMessage({ from: "Acme <billing@Mail.Acme.example>" });
    expect((message.payload as Part).mimeType).toBe("text/plain");
    const headers = fieldsOf(message.payload).headers as { name: string; value: string }[];
    const checks = headers.filter(({ name }) => name === "Authentication-Results");
    expect(checks).toHaveLength(1);
    expect(checks[0].value).toMatch(
      /^mx\.google\.com; .*dmarc=pass .*header\.from=mail\.acme\.example$/,
    );
  });

  it("carries the headers a test gives it, each as many times as given", () => {
    const message = fakeMessage({
      from: ["A <a@one.example>", "B <b@two.example>"],
      authResults: [
        "mx.google.com; dmarc=fail header.from=one.example",
        "mx.evil.example; dmarc=pass",
      ],
      subject: "Two of each",
    });
    const headers = fieldsOf(message.payload).headers as { name: string; value: string }[];
    const valuesOf = (wanted: string) =>
      headers.filter(({ name }) => name === wanted).map(({ value }) => value);
    expect(valuesOf("From")).toEqual(["A <a@one.example>", "B <b@two.example>"]);
    expect(valuesOf("Authentication-Results")).toEqual([
      "mx.google.com; dmarc=fail header.from=one.example",
      "mx.evil.example; dmarc=pass",
    ]);
    expect(valuesOf("Subject")).toEqual(["Two of each"]);
  });

  it("comes with or without the time it arrived", () => {
    expect(fakeMessage().internalDate).toMatch(/^\d{13}$/);
    expect(fakeMessage({ receivedAt: new Date(5_000) }).internalDate).toBe("5000");
    expect("internalDate" in fakeMessage({ receivedAt: null })).toBe(false);
  });
});
