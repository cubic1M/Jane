import { generateKeyPairSync, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TERMS_VERSION } from "@/config/legal";
import type { NoticeWord } from "./notice";

// The three Gmail routes, driven as handlers against a real database and the fake Google: the
// Connect link, the way back from Google's page, and Google's notices. Each check of each route
// has a test that fails without it, and one that fails when it moves past the check after it.
// Claude is off in this file (no key), so a read a route starts stops where it would ask. Nothing
// here talks to Google or Anthropic.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
// This browser: who is signed in to Jane in it, and the cookies it sends.
const browser = vi.hoisted(() => ({
  userId: "",
  termsVersion: "",
  cookies: new Map<string, string>(),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () =>
    browser.userId ? { id: browser.userId, termsVersion: browser.termsVersion } : null,
  ),
  requireUser: vi.fn(async () => ({ id: browser.userId })),
}));
// The routes' own limits are each test's to set. The counters reading keeps stay real.
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOrNull: vi.fn(async () => null),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = browser.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));
// after() runs what it is given at once, as in the bank webhook's test, and the promise is kept: a
// test waits for the read a route started before it looks, and before anyone is deleted.
const afterAnswer = vi.hoisted(() => ({ runs: [] as Promise<unknown>[] }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (run: () => unknown) => {
    afterAnswer.runs.push(Promise.resolve().then(run));
  },
}));
// The team's alarms belong to no person: watched here, not left in a table other files count.
vi.mock("@/lib/ops-alerts", () => ({
  recordOpsEvent: vi.fn(async () => ({ recorded: true, emailed: false })),
}));
// The switches kept in the database: a test has them say reading is stopped.
vi.mock("@/lib/ops-switches", async (original) => ({
  ...(await original<typeof import("@/lib/ops-switches")>()),
  freshSwitches: vi.fn(async () => {}),
}));
// Saving and reading as they are, watched, so a test sees what a route started or makes it fail.
vi.mock("./mailbox", async (original) => {
  const real = await original<typeof import("./mailbox")>();
  return {
    ...real,
    saveMailbox: vi.fn(real.saveMailbox),
    heldByAnyone: vi.fn(real.heldByAnyone),
  };
});
vi.mock("./sync", async (original) => {
  const real = await original<typeof import("./sync")>();
  return {
    ...real,
    syncMailbox: vi.fn(real.syncMailbox),
    syncFromNotice: vi.fn(real.syncFromNotice),
  };
});
// Without the wait between tries, so Gmail failing three times in a row costs no time.
vi.mock("@/config/gmail", async (original) => {
  const real = await original<typeof import("@/config/gmail")>();
  return { ...real, GMAIL_LIMITS: { ...real.GMAIL_LIMITS, callRetryWaitMs: 1 } };
});

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GET as callbackRoute } from "@/app/api/gmail/callback/route";
import { GET as connectRoute } from "@/app/api/gmail/connect/route";
import { POST as webhookRoute } from "@/app/api/gmail/webhook/route";
import {
  GMAIL_CALLBACK_PATH,
  GMAIL_LIMITS,
  GMAIL_PAGE_PATH,
  GMAIL_SCOPE,
  googleServer,
} from "@/config/gmail";
import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { freshSwitches } from "@/lib/ops-switches";
import { limitOrNull } from "@/lib/rate-limit";
import { systemDb } from "@/lib/system-db";
import { FakeGoogle } from "./__fixtures__/fake-google";
import { getProfile } from "./api";
import { makeTicket } from "./connect-ticket";
import { heldByAnyone, saveMailbox } from "./mailbox";
import { NOTICE_COOKIE, openNotice } from "./notice";
import { matchSignIn, SIGN_IN_COOKIE } from "./oauth";
import { openSecrets } from "./secrets";
import { syncFromNotice, syncMailbox } from "./sync";
import { clearGmailWebhookKeysForTests } from "./webhook-verify";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: makes people and checks what the routes left, across tables");
const KEY = randomBytes(32).toString("base64");
const ORIGIN = "http://localhost:3000";
const PAGE = new URL(GMAIL_PAGE_PATH, ORIGIN).toString();
// Auth.js's session cookie on a local address (src/lib/admin-gate.ts).
const SESSION_COOKIE = "authjs.session-token";
const MINUTE = 60_000;

type SetCookie = { value: string; attributes: string };

// The cookies an answer sets, by name.
function cookiesOf(response: Response): Map<string, SetCookie> {
  return new Map(
    response.headers.getSetCookie().map((line): [string, SetCookie] => {
      const [pair, ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      return [
        pair.slice(0, at).trim(),
        {
          value: decodeURIComponent(pair.slice(at + 1)),
          attributes: attributes.map((part) => part.trim()).join("; "),
        },
      ];
    }),
  );
}

// What the mailboxes page will say, from the cookie the answer set.
const noticeIn = (response: Response, userId: string): NoticeWord | null =>
  openNotice(cookiesOf(response).get(NOTICE_COOKIE)?.value, userId, new Date());

// Whether the answer ends the sign-in: its cookie emptied, on its own path, at once.
function endsSignIn(response: Response): boolean {
  const cookie = cookiesOf(response).get(SIGN_IN_COOKIE);
  return (
    cookie?.value === "" &&
    /Max-Age=0/i.test(cookie.attributes) &&
    cookie.attributes.includes(`Path=${GMAIL_CALLBACK_PATH}`)
  );
}

// What the database's driver throws when it can't be reached: its words quote what it was doing.
const databaseDown = (doing: string) =>
  Object.assign(new Error(`Can't reach the database server while ${doing}`), {
    name: "PrismaClientInitializationError",
  });
// What a log line about that error may carry: its class, and nothing it said.
const CLASS_ONLY = JSON.stringify({ kind: "PrismaClientInitializationError" });

// Gmail's notice as Pub/Sub pushes it: Gmail's JSON in base64, in the alphabet asked for. The last
// field is there only so the two alphabets write the data differently.
function noticeBody(fields: Record<string, unknown>, alphabet: BufferEncoding = "base64"): string {
  return JSON.stringify({
    message: {
      data: Buffer.from(JSON.stringify({ ...fields, x: "~~~~~?????" })).toString(alphabet),
      messageId: "2070443601311540",
      publishTime: "2026-11-19T12:00:00.000Z",
    },
    subscription: "projects/jane-mail/subscriptions/gmail-push",
  });
}
const noticeFor = (address: string, alphabet?: BufferEncoding) =>
  noticeBody({ emailAddress: address, historyId: "9007199254741001" }, alphabet);

// A key that isn't Google's, made once for the file: making one takes a moment.
let otherKey: KeyObject | null = null;
const anotherKey = (): KeyObject =>
  (otherKey ??= generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey);

describe.runIf(url)("the Gmail routes", () => {
  let fake: FakeGoogle;
  const people: string[] = [];
  const said: string[] = [];

  async function person(id?: string): Promise<string> {
    const user = await db.user.create({
      data: { ...(id ? { id } : {}), email: `gmail-routes-${randomUUID()}@example.com` },
    });
    people.push(user.id);
    return user.id;
  }
  const trialId = () => `trial_${randomUUID().replaceAll("-", "")}`;
  const newAddress = () => `mailbox.${randomUUID()}@fake-mailbox.test`;

  // This browser, signed in to Jane as the person, in a session of its own and with no other cookie.
  function signedInAs(userId: string): string {
    const sessionToken = `session-${randomUUID()}`;
    browser.userId = userId;
    browser.termsVersion = TERMS_VERSION;
    browser.cookies = new Map([[SESSION_COOKIE, sessionToken]]);
    return sessionToken;
  }

  // Signed in and on the mailboxes page, with the ticket its Connect link carries.
  async function onThePage(id?: string): Promise<{ userId: string; ticket: string }> {
    const userId = await person(id);
    return { userId, ticket: makeTicket(userId, signedInAs(userId), new Date()) };
  }

  // A click on a Connect link: by default the page's own, from this site.
  const connect = (
    ticket: string | null,
    headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
  ) =>
    connectRoute(
      new Request(
        `${ORIGIN}/api/gmail/connect${ticket === null ? "" : `?ticket=${encodeURIComponent(ticket)}`}`,
        { headers },
      ),
    );

  // The trip up to the way back: the Connect link, Google's page, and the address Google sends the
  // browser back to. The browser keeps the sign-in cookie, as it would.
  async function toGoogleAndBack(
    userId: string,
    choice: "allow" | "deny" = "allow",
  ): Promise<string> {
    const started = await connect(makeTicket(userId, signedInAs(userId), new Date()));
    expect(started.status).toBe(303);
    const signIn = cookiesOf(started).get(SIGN_IN_COOKIE)?.value ?? "";
    expect(signIn).not.toBe("");
    browser.cookies.set(SIGN_IN_COOKIE, signIn);
    return fake.signIn(started.headers.get("location") ?? "", choice);
  }
  const comeBack = (to: string) => callbackRoute(new Request(to));

  // A mailbox the person connected before, saved as the way back saves one, with tokens the fake
  // takes.
  async function holding(
    userId: string,
    address = newAddress(),
  ): Promise<{ id: string; address: string }> {
    const saved = await saveMailbox(userId, {
      address,
      historyId: fake.mailbox(address).historyId,
      tokens: {
        ...fake.issueTokensForTest(address),
        expiresAt: new Date(Date.now() + 60 * MINUTE),
      },
      disclosureVersion: GMAIL_DISCLOSURE_VERSION,
    });
    if ("refused" in saved) throw new Error("The mailbox was refused");
    return { id: saved.id, address };
  }

  // A notice from Google arriving, with a token Google signed for Jane unless the test says not.
  const push = (body: string, headers?: Record<string, string>) =>
    webhookRoute(
      new Request(`${ORIGIN}/api/gmail/webhook`, {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          ...(headers ?? { authorization: `Bearer ${fake.noticeToken()}` }),
        },
      }),
    );

  // Waits for what the routes started after their answers.
  async function settled(): Promise<void> {
    while (afterAnswer.runs.length > 0) await Promise.all(afterAnswer.runs.splice(0));
  }

  // The person's own limit for one route says no.
  const limited = (name: string) =>
    vi
      .mocked(limitOrNull)
      .mockImplementation(async (which) =>
        which === name ? NextResponse.json({ error: "Too many requests" }, { status: 429 }) : null,
      );
  // The switches kept in the database turn out to say reading is stopped, as freshSwitches reads them.
  const stoppedInTheStore = () =>
    vi.mocked(freshSwitches).mockImplementationOnce(async () => {
      vi.stubEnv("KILL_BANKS", "1");
    });

  const rowOf = (id: string) => system().gmailMailbox.findUniqueOrThrow({ where: { id } });
  const mailboxesOf = (userId: string) => system().gmailMailbox.findMany({ where: { userId } });
  const auditOf = async (userId: string) =>
    (
      await system().auditLog.findMany({
        where: { actorId: userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    ).map(({ event, targetType, targetId, metadata }) => ({
      event,
      targetType,
      targetId,
      metadata,
    }));
  const eventsOf = async (userId: string) =>
    (
      await system().analyticsEvent.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    ).map(({ name, properties }) => ({ name, properties }));
  // A failed connection's one audit record, with its code.
  const connectFailed = (userId: string, code: string) => ({
    event: "gmail_connect_failed",
    targetType: "user",
    targetId: userId,
    metadata: { user_id: userId, code },
  });
  // What the fake Google was asked at addresses ending this way.
  const asked = (ending: string) =>
    fake.requests.filter((request) => request.path.endsWith(ending));

  function expectBackToPage(answer: Response): void {
    expect(answer.status).toBe(303);
    expect(answer.headers.get("location")).toBe(PAGE);
  }
  async function expectNothingStarted(userId: string, answer: Response): Promise<void> {
    expect(cookiesOf(answer).has(SIGN_IN_COOKIE)).toBe(false);
    expect(answer.headers.get("location") ?? "").not.toContain(fake.origin);
    expect(await eventsOf(userId)).toEqual([]);
    expect(fake.requests).toEqual([]);
  }
  // The tokens a mailbox holds still work at Google: nothing ended its permission.
  async function expectStillReads(id: string, address: string): Promise<void> {
    const row = await rowOf(id);
    expect(row.status).toBe("active");
    const { accessToken } = openSecrets(row.secretsEncrypted);
    const access = { token: async () => accessToken ?? "", renew: async () => accessToken ?? "" };
    await expect(getProfile(access)).resolves.toMatchObject({ address });
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    fake = await new FakeGoogle().start();
    // The keys Jane holds outlive one fake Google, and each fake signs with a key of its own.
    clearGmailWebhookKeysForTests();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
    vi.stubEnv("GMAIL_LINK", "1");
    vi.stubEnv("KILL_BANKS", "");
    vi.stubEnv("OPS_SWITCHES", "");
    // Claude is off: a read started here stops where it would ask.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("POSTHOG_KEY", "");
    vi.stubEnv("AUTH_URL", ORIGIN);
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    // The fake Google is used only outside production.
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GMAIL_API_URL", fake.origin);
    vi.stubEnv("GMAIL_CLIENT_ID", fake.clientId);
    vi.stubEnv("GMAIL_CLIENT_SECRET", fake.clientSecret);
    vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
    vi.stubEnv("GMAIL_PUSH_AUDIENCE", fake.pushAudience);
    vi.stubEnv("GMAIL_PUSH_SERVICE_ACCOUNT", fake.pushServiceAccount);
    browser.userId = "";
    browser.termsVersion = TERMS_VERSION;
    browser.cookies = new Map();
    said.length = 0;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });
  afterEach(async () => {
    await settled();
    await fake.stop();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    const boxes = await system().gmailMailbox.findMany({
      where: { userId: { in: people } },
      select: { id: true },
    });
    await system().auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: people } },
          { targetType: "gmail_mailbox", targetId: { in: boxes.map((box) => box.id) } },
        ],
      },
    });
    if (people.length > 0) {
      await system().rateLimit.deleteMany({
        where: { OR: people.map((id) => ({ key: { endsWith: `:${id}` } })) },
      });
    }
    await system().user.deleteMany({ where: { id: { in: people } } });
  });

  it("switched off, all three answer 404, and nothing is started, saved or read", async () => {
    const userId = await person();
    const { address } = await holding(userId);
    fake.options.address = newAddress();
    const back = await toGoogleAndBack(userId);
    const ticket = makeTicket(userId, browser.cookies.get(SESSION_COOKIE) ?? "", new Date());
    vi.stubEnv("GMAIL_LINK", "");
    fake.requests.splice(0);
    expect((await connect(ticket)).status).toBe(404);
    expect((await comeBack(back)).status).toBe(404);
    expect((await push(noticeFor(address))).status).toBe(404);
    await settled();
    expect(fake.requests).toEqual([]);
    expect(syncMailbox).not.toHaveBeenCalled();
    expect(syncFromNotice).not.toHaveBeenCalled();
    expect(recordOpsEvent).not.toHaveBeenCalled();
    expect((await mailboxesOf(userId)).map((row) => row.address)).toEqual([address]);
    expect(await auditOf(userId)).toEqual([]);
  });

  describe("the Connect link", () => {
    it("a click on the mailboxes page goes to Google's page with the state, and a cookie only the way back gets", async () => {
      const { userId, ticket } = await onThePage();
      const started = await connect(ticket);
      expect(started.status).toBe(303);
      const to = new URL(started.headers.get("location") ?? "");
      expect(`${to.origin}${to.pathname}`).toBe(googleServer().authorize);
      expect(to.searchParams.get("redirect_uri")).toBe(`${ORIGIN}${GMAIL_CALLBACK_PATH}`);
      expect(to.searchParams.get("scope")).toBe(GMAIL_SCOPE);
      const state = to.searchParams.get("state");
      expect(state).toBeTruthy();
      const set = cookiesOf(started);
      expect([...set.keys()]).toEqual([SIGN_IN_COOKIE]);
      const signIn = set.get(SIGN_IN_COOKIE);
      expect(signIn?.attributes).toContain(`Path=${GMAIL_CALLBACK_PATH}`);
      expect(signIn?.attributes).toMatch(/HttpOnly/i);
      expect(signIn?.attributes).toMatch(/SameSite=lax/i);
      expect(signIn?.attributes).toContain(`Max-Age=${GMAIL_LIMITS.signInMinutes * 60}`);
      expect(signIn?.attributes).not.toMatch(/Secure/i);
      // The cookie is this sign-in's, for this person, under the words the page showed them.
      expect(matchSignIn(signIn?.value, { userId, state })).toMatchObject({
        disclosure: GMAIL_DISCLOSURE_VERSION,
      });
      expect(await eventsOf(userId)).toEqual([{ name: "gmail_connect_started", properties: {} }]);
      expect(await mailboxesOf(userId)).toEqual([]);
    });

    it("marks its cookies Secure when the site is on https", async () => {
      vi.stubEnv("AUTH_URL", "https://jane.example");
      const { userId, ticket } = await onThePage();
      expect(cookiesOf(await connect(ticket)).get(SIGN_IN_COOKIE)?.attributes).toMatch(/Secure/i);
      const back = await connect(null);
      expect(back.headers.get("location")).toBe(
        new URL(GMAIL_PAGE_PATH, "https://jane.example").toString(),
      );
      expect(noticeIn(back, userId)).toBe("start_here");
      expect(cookiesOf(back).get(NOTICE_COOKIE)?.attributes).toMatch(/Secure/i);
    });

    it("switched off, answers 404 before asking who is signed in", async () => {
      const { ticket } = await onThePage();
      vi.stubEnv("GMAIL_LINK", "");
      browser.userId = "";
      expect((await connect(ticket)).status).toBe(404);
    });

    it("answers 401 to a browser nobody is signed in on", async () => {
      const { ticket } = await onThePage();
      browser.userId = "";
      expect((await connect(ticket)).status).toBe(401);
      expect(fake.requests).toEqual([]);
    });

    it("answers 403 until the Terms are accepted, before it asks whether connecting is set up", async () => {
      const { userId, ticket } = await onThePage();
      browser.termsVersion = "2020-01-01";
      vi.stubEnv("GMAIL_CLIENT_SECRET", "");
      const answer = await connect(ticket);
      expect(answer.status).toBe(403);
      await expectNothingStarted(userId, answer);
    });

    it("answers 503 when connecting isn't set up, before it looks at where the click came from", async () => {
      const { userId, ticket } = await onThePage();
      vi.stubEnv("GMAIL_CLIENT_SECRET", "");
      const answer = await connect(ticket, { "sec-fetch-site": "cross-site" });
      expect(answer.status).toBe(503);
      await expectNothingStarted(userId, answer);
    });

    it("answers 503 without the site's own address to come back to", async () => {
      const { userId, ticket } = await onThePage();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", "");
      const answer = await connect(ticket, { "sec-fetch-site": "cross-site" });
      expect(answer.status).toBe(503);
      await expectNothingStarted(userId, answer);
    });

    it("sends a link from another site back as not connected, before the person's limit is spent", async () => {
      const { userId, ticket } = await onThePage();
      limited("gmail");
      const answer = await connect(ticket, { "sec-fetch-site": "cross-site" });
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(limitOrNull).not.toHaveBeenCalled();
      await expectNothingStarted(userId, answer);
    });

    it("answers 429 past the person's limit, before it asks whether reading is paused", async () => {
      const { userId, ticket } = await onThePage();
      limited("gmail");
      vi.stubEnv("KILL_BANKS", "1");
      const answer = await connect(ticket);
      expect(answer.status).toBe(429);
      expect(limitOrNull).toHaveBeenCalledWith("gmail", userId);
      await expectNothingStarted(userId, answer);
    });

    it("goes back as paused while reading is paused, before it looks at the ticket", async () => {
      const { userId } = await onThePage();
      vi.stubEnv("KILL_BANKS", "1");
      const answer = await connect(null);
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("paused");
      await expectNothingStarted(userId, answer);
    });

    it("asks the switches kept in the database before it goes on", async () => {
      const { userId, ticket } = await onThePage();
      stoppedInTheStore();
      const answer = await connect(ticket);
      expect(noticeIn(answer, userId)).toBe("paused");
      await expectNothingStarted(userId, answer);
    });

    it("without a ticket starts nothing and says to start from the page, before it asks who may connect", async () => {
      const userId = await person(trialId());
      signedInAs(userId);
      const answer = await connect(null);
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("start_here");
      const notice = cookiesOf(answer).get(NOTICE_COOKIE);
      expect(notice?.attributes).toContain(`Path=${GMAIL_PAGE_PATH}`);
      expect(notice?.attributes).toMatch(/HttpOnly/i);
      expect(notice?.attributes).toMatch(/SameSite=lax/i);
      expect(notice?.attributes).toContain(`Max-Age=${GMAIL_LIMITS.noticeSeconds}`);
      expect(notice?.attributes).not.toMatch(/Secure/i);
      await expectNothingStarted(userId, answer);
    });

    it("starts nothing with another session's ticket, as a sign-in link someone else sent would bring", async () => {
      // Someone makes a ticket on their own mailboxes page, then sends a sign-in link to their own
      // account that ends at the Connect address. The browser that opens it is signed in to their
      // account, in a session they didn't make and can't know.
      const { userId, ticket } = await onThePage();
      signedInAs(userId);
      const answer = await connect(ticket, { "sec-fetch-site": "none" });
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("start_here");
      await expectNothingStarted(userId, answer);
    });

    it("starts nothing with a ticket older than the page's link stays good", async () => {
      const userId = await person();
      const made = new Date(Date.now() - GMAIL_LIMITS.ticketMinutes * MINUTE - MINUTE);
      const answer = await connect(makeTicket(userId, signedInAs(userId), made));
      expect(noticeIn(answer, userId)).toBe("start_here");
      await expectNothingStarted(userId, answer);
    });

    it("starts nothing with another person's ticket", async () => {
      const other = await person();
      const userId = await person();
      const answer = await connect(makeTicket(other, signedInAs(userId), new Date()));
      expect(noticeIn(answer, userId)).toBe("start_here");
      await expectNothingStarted(userId, answer);
    });

    it("refuses a sample account with 403, and starts nothing", async () => {
      const { userId, ticket } = await onThePage(trialId());
      const answer = await connect(ticket);
      expect(answer.status).toBe(403);
      expect(cookiesOf(answer).size).toBe(0);
      await expectNothingStarted(userId, answer);
    });
  });

  describe("the way back from Google", () => {
    it("saves the mailbox Google names, says connected, ends the sign-in and reads it after the answer", async () => {
      const userId = await person();
      const address = newAddress();
      // Google gives an address back as it was written, capitals and all.
      fake.options.address = address.toUpperCase();
      const answer = await comeBack(await toGoogleAndBack(userId));
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("connected");
      expect(endsSignIn(answer)).toBe(true);
      const rows = await mailboxesOf(userId);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({
        address,
        status: "active",
        historyCursor: fake.mailbox(address).historyId,
        disclosureVersion: GMAIL_DISCLOSURE_VERSION,
      });
      expect(await auditOf(userId)).toEqual([
        {
          event: "gmail_connected",
          targetType: "gmail_mailbox",
          targetId: row.id,
          metadata: expect.objectContaining({
            user_id: userId,
            reconnected: false,
            took_over: false,
          }),
        },
      ]);
      expect(await eventsOf(userId)).toEqual([
        { name: "gmail_connect_started", properties: {} },
        { name: "gmail_connected", properties: { reconnected: false, took_over: false } },
      ]);
      await settled();
      expect(syncMailbox).toHaveBeenCalledTimes(1);
      expect(syncMailbox).toHaveBeenCalledWith(userId, row.id);
      // Claude is off in this file, so the read stops where it would ask.
      await expect(vi.mocked(syncMailbox).mock.results[0]?.value).resolves.toBe("waiting");
      expect((await rowOf(row.id)).syncingSince).toBeNull();
    });

    it("connecting the same mailbox again keeps one row and says connected", async () => {
      const userId = await person();
      const address = newAddress();
      fake.options.address = address;
      expect(noticeIn(await comeBack(await toGoogleAndBack(userId)), userId)).toBe("connected");
      const again = await comeBack(await toGoogleAndBack(userId));
      expect(noticeIn(again, userId)).toBe("connected");
      expect(endsSignIn(again)).toBe(true);
      expect(await mailboxesOf(userId)).toHaveLength(1);
      expect((await auditOf(userId)).at(-1)).toMatchObject({
        event: "gmail_connected",
        metadata: { reconnected: true, took_over: false },
      });
      expect(fake.revokedTokens).toEqual([]);
    });

    it("connecting an address another person holds moves it here, and says so", async () => {
      const earlier = await person();
      const theirs = await holding(earlier);
      const userId = await person();
      fake.options.address = theirs.address;
      const answer = await comeBack(await toGoogleAndBack(userId));
      expect(noticeIn(answer, userId)).toBe("connected_moved");
      expect(endsSignIn(answer)).toBe(true);
      expect((await rowOf(theirs.id)).status).toBe("elsewhere");
      const [mine] = await mailboxesOf(userId);
      expect(mine).toMatchObject({ address: theirs.address, status: "active" });
      expect(await auditOf(userId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: "gmail_taken_over", targetId: theirs.id }),
          expect.objectContaining({
            event: "gmail_connected",
            targetId: mine.id,
            metadata: expect.objectContaining({ took_over: true }),
          }),
        ]),
      );
      // Their tokens were wiped here; the permission at Google is the new holder's too.
      expect(fake.revokedTokens).toEqual([]);
    });

    it("switched off, answers 404 before asking who is signed in", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      vi.stubEnv("GMAIL_LINK", "");
      browser.userId = "";
      expect((await comeBack(back)).status).toBe(404);
    });

    it("answers 401 to a browser nobody is signed in on, before it asks for the site's own address", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      browser.userId = "";
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", "");
      expect((await comeBack(back)).status).toBe(401);
      expect(asked("/token")).toEqual([]);
    });

    it("answers 503 without the site's own address, before it asks whether reading is paused", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", "");
      vi.stubEnv("KILL_BANKS", "1");
      expect((await comeBack(back)).status).toBe(503);
      expect(asked("/token")).toEqual([]);
    });

    it("goes back as paused under KILL_BANKS before it reads the sign-in cookie, and saves nothing", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      vi.stubEnv("KILL_BANKS", "1");
      vi.mocked(cookies).mockClear();
      fake.requests.splice(0);
      const answer = await comeBack(back);
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("paused");
      expect(cookies).not.toHaveBeenCalled();
      expect(cookiesOf(answer).has(SIGN_IN_COOKIE)).toBe(false);
      expect(fake.requests).toEqual([]);
      expect(await mailboxesOf(userId)).toEqual([]);
      expect(await auditOf(userId)).toEqual([]);
    });

    it("asks the switches kept in the database before it goes on", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      stoppedInTheStore();
      const answer = await comeBack(back);
      expect(noticeIn(answer, userId)).toBe("paused");
      expect(asked("/token")).toEqual([]);
      expect(await mailboxesOf(userId)).toEqual([]);
    });

    it("a way back that isn't this sign-in's leaves the sign-in under way, and is audited", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      const forged = new URL(back);
      forged.searchParams.set("state", "a-state-someone-else-chose");
      const answer = await comeBack(forged.toString());
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(cookiesOf(answer).has(SIGN_IN_COOKIE)).toBe(false);
      expect(asked("/token")).toEqual([]);
      expect(limitOrNull).toHaveBeenCalledWith("gmailForgedBack", userId);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "state")]);
      // The sign-in this person has under way still finishes.
      expect(noticeIn(await comeBack(back), userId)).toBe("connected");
    });

    it("past its limit, a forged way back writes no audit record", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const forged = new URL(await toGoogleAndBack(userId));
      forged.searchParams.set("state", "a-state-someone-else-chose");
      limited("gmailForgedBack");
      const answer = await comeBack(forged.toString());
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(cookiesOf(answer).has(SIGN_IN_COOKIE)).toBe(false);
      expect(await auditOf(userId)).toEqual([]);
    });

    it("a refusal another site wrote leaves the sign-in under way, before the missing code is looked at", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      // Google's words for a refusal, with no code, under a state that isn't this sign-in's.
      const forged = new URL(GMAIL_CALLBACK_PATH, ORIGIN);
      forged.searchParams.set("error", "access_denied");
      forged.searchParams.set("state", "a-state-someone-else-chose");
      const answer = await comeBack(forged.toString());
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(cookiesOf(answer).has(SIGN_IN_COOKIE)).toBe(false);
      expect(limitOrNull).toHaveBeenCalledWith("gmailForgedBack", userId);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "state")]);
      // The sign-in this person has under way still finishes.
      expect(noticeIn(await comeBack(back), userId)).toBe("connected");
    });

    it("a person who says no on Google's page goes back as not connected, before who may connect is asked", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId, "deny");
      // A sample account by now, too: a refusal is still a refusal.
      await db.plaidItem.create({
        data: {
          userId,
          plaidItemId: `demo-${randomUUID()}`,
          accessTokenEncrypted: encrypt("demo-token"),
        },
      });
      const answer = await comeBack(back);
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(endsSignIn(answer)).toBe(true);
      expect(asked("/token")).toEqual([]);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "denied")]);
      expect(await mailboxesOf(userId)).toEqual([]);
    });

    it("a way back with neither a code nor a refusal is not connected", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = new URL(await toGoogleAndBack(userId));
      back.searchParams.delete("code");
      const answer = await comeBack(back.toString());
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(endsSignIn(answer)).toBe(true);
      expect(asked("/token")).toEqual([]);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "no_code")]);
    });

    it("refuses a person whose only bank is now the demo bank, before anything is exchanged", async () => {
      const userId = await person();
      fake.options.address = newAddress();
      const back = await toGoogleAndBack(userId);
      await db.plaidItem.create({
        data: {
          userId,
          plaidItemId: `demo-${randomUUID()}`,
          accessTokenEncrypted: encrypt("demo-token"),
        },
      });
      const answer = await comeBack(back);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(endsSignIn(answer)).toBe(true);
      expect(asked("/token")).toEqual([]);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "refused")]);
      expect(await mailboxesOf(userId)).toEqual([]);
    });

    const BEFORE_THE_ADDRESS: [string, () => void, string, NoticeWord][] = [
      [
        "Google granted something other than reading",
        () => {
          fake.options.grantedScope = "openid email";
        },
        "scope",
        "not_allowed",
      ],
      [
        "no refresh token came",
        () => {
          fake.options.noRefreshToken = true;
        },
        "no_refresh",
        "not_connected",
      ],
      [
        "Google turned Jane's own client away",
        () => vi.stubEnv("GMAIL_CLIENT_SECRET", "not-the-secret"),
        "client",
        "not_connected",
      ],
      [
        "the token address failed",
        () => fake.answerWith("/token", 500),
        "token_http_500",
        "not_connected",
      ],
      [
        "Gmail turned the new token away",
        () => fake.answerWith("/profile", 401),
        "signed_out",
        "not_connected",
      ],
      [
        "Gmail was down",
        () => fake.answerWith("/profile", 503, { times: 1 + GMAIL_LIMITS.callRetries }),
        "http_503",
        "not_connected",
      ],
      [
        "Gmail named no mailbox",
        () => fake.answerWith("/profile", 200, { body: { historyId: "1" } }),
        "shape",
        "not_connected",
      ],
    ];
    it.each(BEFORE_THE_ADDRESS)(
      "a sign-in that fails before the address is known ends nothing at Google: %s",
      async (_what, happen, code, word) => {
        const userId = await person();
        fake.options.address = newAddress();
        const back = await toGoogleAndBack(userId);
        happen();
        const answer = await comeBack(back);
        expectBackToPage(answer);
        expect(noticeIn(answer, userId)).toBe(word);
        expect(endsSignIn(answer)).toBe(true);
        expect(asked("/revoke")).toEqual([]);
        expect(await mailboxesOf(userId)).toEqual([]);
        expect(await auditOf(userId)).toEqual([connectFailed(userId, code)]);
        await settled();
        expect(syncMailbox).not.toHaveBeenCalled();
      },
    );

    it("a code used twice is refused by Google, ends nothing, and the mailbox it connected stays", async () => {
      const userId = await person();
      const address = newAddress();
      fake.options.address = address;
      const back = await toGoogleAndBack(userId);
      expect(noticeIn(await comeBack(back), userId)).toBe("connected");
      // Back, or a reload: the browser here still sends the sign-in cookie.
      const again = await comeBack(back);
      expect(noticeIn(again, userId)).toBe("not_connected");
      expect(endsSignIn(again)).toBe(true);
      expect(asked("/revoke")).toEqual([]);
      expect((await auditOf(userId)).at(-1)).toEqual(connectFailed(userId, "grant"));
      const [row] = await mailboxesOf(userId);
      await expectStillReads(row.id, address);
    });

    it("connecting an active mailbox again while Gmail fails sends no revoke, and the mailbox still reads", async () => {
      const userId = await person();
      const { id, address } = await holding(userId);
      fake.options.address = address;
      const back = await toGoogleAndBack(userId);
      fake.answerWith("/profile", 503, { times: 1 + GMAIL_LIMITS.callRetries });
      const answer = await comeBack(back);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(endsSignIn(answer)).toBe(true);
      expect(asked("/revoke")).toEqual([]);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "http_503")]);
      await expectStillReads(id, address);
    });

    it("a new address at the cap is refused, and what Google gave for it is ended there", async () => {
      const userId = await person();
      for (let i = 0; i < GMAIL_LIMITS.mailboxesMost; i += 1) await holding(userId);
      const address = newAddress();
      fake.options.address = address;
      const answer = await comeBack(await toGoogleAndBack(userId));
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("too_many");
      expect(endsSignIn(answer)).toBe(true);
      expect(fake.revokedTokens).toHaveLength(1);
      expect(fake.revokedTokens[0]).toMatch(/^fake-refresh-/);
      expect(await system().gmailMailbox.count({ where: { address } })).toBe(0);
      expect(await mailboxesOf(userId)).toHaveLength(GMAIL_LIMITS.mailboxesMost);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "too_many")]);
    });

    it("an address someone else holds, refused at the cap, is not ended at Google", async () => {
      const holder = await person();
      const theirs = await holding(holder);
      const userId = await person();
      for (let i = 0; i < GMAIL_LIMITS.mailboxesMost; i += 1) await holding(userId);
      fake.options.address = theirs.address;
      const answer = await comeBack(await toGoogleAndBack(userId));
      expect(noticeIn(answer, userId)).toBe("too_many");
      expect(endsSignIn(answer)).toBe(true);
      expect(asked("/revoke")).toEqual([]);
      await expectStillReads(theirs.id, theirs.address);
    });

    it("a save that fails ends what Google gave when nobody holds the address", async () => {
      const userId = await person();
      const address = newAddress();
      fake.options.address = address;
      const back = await toGoogleAndBack(userId);
      vi.mocked(saveMailbox).mockRejectedValueOnce(databaseDown(`saving ${address}`));
      const answer = await comeBack(back);
      expectBackToPage(answer);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(endsSignIn(answer)).toBe(true);
      expect(fake.revokedTokens).toHaveLength(1);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "save")]);
      // The error's class, and nothing it said.
      expect(said).toEqual([`Gmail mailbox wasn't saved ${CLASS_ONLY}`]);
    });

    it("a save that fails while nobody can say who holds the address ends nothing at Google", async () => {
      const userId = await person();
      const address = newAddress();
      fake.options.address = address;
      const back = await toGoogleAndBack(userId);
      vi.mocked(saveMailbox).mockRejectedValueOnce(databaseDown(`saving ${address}`));
      vi.mocked(heldByAnyone).mockRejectedValueOnce(databaseDown(`counting ${address}`));
      const answer = await comeBack(back);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(endsSignIn(answer)).toBe(true);
      expect(heldByAnyone).toHaveBeenCalledWith(address);
      expect(asked("/revoke")).toEqual([]);
      expect(await auditOf(userId)).toEqual([connectFailed(userId, "save")]);
    });

    it("a save that fails ends nothing while the address is held: the person's own mailbox keeps working", async () => {
      const userId = await person();
      const { id, address } = await holding(userId);
      fake.options.address = address;
      const back = await toGoogleAndBack(userId);
      vi.mocked(saveMailbox).mockRejectedValueOnce(databaseDown(`saving ${address}`));
      const answer = await comeBack(back);
      expect(noticeIn(answer, userId)).toBe("not_connected");
      expect(endsSignIn(answer)).toBe(true);
      expect(asked("/revoke")).toEqual([]);
      await expectStillReads(id, address);
    });

    it("the first read breaking after the answer is logged by the error's class only", async () => {
      const userId = await person();
      const address = newAddress();
      fake.options.address = address;
      vi.mocked(syncMailbox).mockRejectedValueOnce(databaseDown(`locking ${address}`));
      const answer = await comeBack(await toGoogleAndBack(userId));
      expect(noticeIn(answer, userId)).toBe("connected");
      await settled();
      expect(said).toEqual([`Gmail first read broke ${CLASS_ONLY}`]);
    });

    it("no address, token, code or state reaches a log, an audit record, an analytics event or a way back", async () => {
      const userId = await person();
      const address = newAddress();
      fake.options.address = address;
      const back = new URL(await toGoogleAndBack(userId));
      const forged = new URL(back);
      forged.searchParams.set("state", `forged-${randomUUID()}`);
      const answers = [
        await comeBack(forged.toString()),
        await comeBack(back.toString()),
        // The same code again.
        await comeBack(back.toString()),
      ];
      await settled();
      const [row] = await mailboxesOf(userId);
      const { accessToken, refreshToken } = openSecrets(row.secretsEncrypted);
      const kept = [
        address,
        back.searchParams.get("code"),
        back.searchParams.get("state"),
        forged.searchParams.get("state"),
        accessToken,
        refreshToken,
      ].filter((value): value is string => Boolean(value));
      expect(kept).toHaveLength(6);
      const written = [
        ...said,
        ...answers.map((answer) => answer.headers.get("location") ?? ""),
        JSON.stringify(await system().auditLog.findMany({ where: { actorId: userId } })),
        JSON.stringify(await eventsOf(userId)),
      ].join("\n");
      for (const value of kept) expect(written).not.toContain(value);
    });
  });

  describe("Google's notices", () => {
    it("reads the mailbox a notice names, after the answer", async () => {
      const { address } = await holding(await person());
      const answer = await push(noticeFor(address.toUpperCase()));
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ received: true });
      await settled();
      expect(syncFromNotice).toHaveBeenCalledTimes(1);
      expect(syncFromNotice).toHaveBeenCalledWith(address);
      // Claude is off in this file, so the read stops where it would ask.
      await expect(vi.mocked(syncFromNotice).mock.results[0]?.value).resolves.toBe("waiting");
    });

    it("takes Gmail's JSON in either base64 alphabet", async () => {
      const { address } = await holding(await person());
      const data = (body: string) =>
        (JSON.parse(body) as { message: { data: string } }).message.data;
      const standard = noticeFor(address, "base64");
      const urlSafe = noticeFor(address, "base64url");
      // The two really are written differently.
      expect(data(standard)).toMatch(/[+/]/);
      expect(data(urlSafe)).toMatch(/[-_]/);
      expect((await push(standard)).status).toBe(200);
      expect((await push(urlSafe)).status).toBe(200);
      await settled();
      expect(vi.mocked(syncFromNotice).mock.calls).toEqual([[address], [address]]);
    });

    it("acknowledges a notice for an address nobody connected, and reads nothing", async () => {
      const answer = await push(noticeFor(newAddress()));
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ received: true });
      await settled();
      await expect(vi.mocked(syncFromNotice).mock.results[0]?.value).resolves.toBe("none");
    });

    const MARKER = "notice-content-marker";
    it.each([
      ["isn't JSON", `{"message": ${MARKER}`],
      ["has no message", JSON.stringify({ subscription: MARKER })],
      ["has data that isn't text", JSON.stringify({ message: { data: 42, messageId: MARKER } })],
      [
        "has data that isn't JSON",
        JSON.stringify({ message: { data: Buffer.from(`${MARKER} {`).toString("base64") } }),
      ],
      ["names no mailbox", noticeBody({ historyId: MARKER })],
      ["names something that isn't an address", noticeBody({ emailAddress: `${MARKER} at home` })],
    ])(
      "acknowledges and drops a notice that %s, with one warning that says nothing of it",
      async (_what, body) => {
        const answer = await push(body);
        expect(answer.status).toBe(200);
        await settled();
        expect(syncFromNotice).not.toHaveBeenCalled();
        expect(said).toEqual(["Gmail notice not understood"]);
      },
    );

    it.each([
      ["no token", (): Record<string, string> => ({})],
      ["a token that isn't one", () => ({ authorization: "Bearer not.a-token" })],
      [
        "a token signed with a key that isn't Google's",
        () => ({ authorization: `Bearer ${fake.noticeToken({ key: anotherKey() })}` }),
      ],
    ])(
      "refuses a notice with %s: 401, one ops event, and nothing read",
      async (_what, headersOf) => {
        const { address } = await holding(await person());
        const answer = await push(noticeFor(address), headersOf());
        expect(answer.status).toBe(401);
        expect(recordOpsEvent).toHaveBeenCalledTimes(1);
        expect(recordOpsEvent).toHaveBeenCalledWith("gmail_webhook_unverified");
        await settled();
        expect(syncFromNotice).not.toHaveBeenCalled();
      },
    );

    it("verifies before it reads anything in the body", async () => {
      const answer = await push("not a notice", { authorization: "Bearer not.a-token" });
      expect(answer.status).toBe(401);
      expect(said).toEqual([]);
    });

    it("switched off, answers 404 before it looks at the size or the token", async () => {
      vi.stubEnv("GMAIL_LINK", "");
      const answer = await push(noticeFor(newAddress()), {
        authorization: "Bearer not.a-token",
        "content-length": String(GMAIL_LIMITS.webhookBytes + 1),
      });
      expect(answer.status).toBe(404);
      expect(recordOpsEvent).not.toHaveBeenCalled();
    });

    it("answers 413 to a notice that says it is over the size, before its token is looked at", async () => {
      const answer = await push(noticeFor(newAddress()), {
        authorization: "Bearer not.a-token",
        "content-length": String(GMAIL_LIMITS.webhookBytes + 1),
      });
      expect(answer.status).toBe(413);
      expect(recordOpsEvent).not.toHaveBeenCalled();
    });

    it("answers 413 to a body over the size whatever it says of itself, and takes one at the size", async () => {
      const { address } = await holding(await person());
      const notice = noticeFor(address);
      const over = await push(notice.padEnd(GMAIL_LIMITS.webhookBytes + 1, " "), {
        authorization: "Bearer not.a-token",
      });
      expect(over.status).toBe(413);
      expect(recordOpsEvent).not.toHaveBeenCalled();
      const at = await push(notice.padEnd(GMAIL_LIMITS.webhookBytes, " "));
      expect(at.status).toBe(200);
      await settled();
      expect(syncFromNotice).toHaveBeenCalledWith(address);
    });

    it("counts a notice it can't read even while reading is paused", async () => {
      vi.stubEnv("KILL_BANKS", "1");
      const answer = await push(noticeBody({ historyId: "1" }));
      expect(answer.status).toBe(200);
      expect(said).toEqual(["Gmail notice not understood"]);
    });

    it("acknowledges a notice while reading is paused, and reads nothing", async () => {
      const { address } = await holding(await person());
      vi.stubEnv("KILL_BANKS", "1");
      const answer = await push(noticeFor(address));
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ received: true });
      await settled();
      expect(syncFromNotice).not.toHaveBeenCalled();
    });

    it("asks the switches kept in the database before it reads", async () => {
      const { address } = await holding(await person());
      stoppedInTheStore();
      expect((await push(noticeFor(address))).status).toBe(200);
      await settled();
      expect(syncFromNotice).not.toHaveBeenCalled();
    });

    it("a read that breaks after the answer is logged by the error's class only", async () => {
      const { address } = await holding(await person());
      vi.mocked(syncFromNotice).mockRejectedValueOnce(databaseDown(`reading ${address}`));
      expect((await push(noticeFor(address))).status).toBe(200);
      await settled();
      expect(said).toEqual([`Gmail read from a notice broke ${CLASS_ONLY}`]);
    });
  });
});
