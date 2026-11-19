import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS } from "@/config/gmail";
import {
  GMAIL_CONSENT,
  GMAIL_DISCLOSURE_VERSION,
  gmailDisclosure,
} from "@/config/gmail-disclosure";
import { momentLabel } from "@/lib/day-label";
import { makeTicket, ticketHolds } from "@/lib/gmail/connect-ticket";
import type { MailboxView, ReadingView } from "@/lib/gmail/mailbox";
import { NOTICE_COOKIE, sealNotice, type NoticeWord } from "@/lib/gmail/notice";
import { momentTimeLabel } from "@/lib/moment-time";

// /settings/mailboxes (DESIGN section 11): what the page says for each state of a mailbox, when
// it offers the Connect link (and that the link's route refuses in the page's words), and that
// nothing reaches it from the address bar or leaves it that shouldn't. The store's views are
// stand-ins here; mailbox.integration.test.ts holds them to the database, and that they never carry
// tokens or the cursor.

const ME = "person_me";
const SESSION = "session-token-of-this-browser";
const TIMEZONE = "America/Los_Angeles";
const KEY = randomBytes(32).toString("base64");
const NOW = new Date("2026-11-19T18:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const DAY_MINUTES = 24 * 60;

const mocks = vi.hoisted(() => ({
  mailboxesView: vi.fn(),
  readingsView: vi.fn(),
  whyCantConnect: vi.fn(),
  removeMailbox: vi.fn(),
  readerReady: vi.fn(),
  jar: new Map<string, string>(),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));
vi.mock("@/lib/session", () => {
  const me = async () => ({
    id: "person_me",
    email: "person@jane.test",
    role: "user",
    termsVersion: (await import("@/config/legal")).TERMS_VERSION,
  });
  return { requireUser: me, getCurrentUser: me };
});
// What the connect route asks before it gets to who may connect.
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: async () => null }));
vi.mock("@/lib/ops-switches", () => ({ freshSwitches: async () => undefined }));
vi.mock("@/lib/gmail/mailbox", () => ({
  mailboxesView: mocks.mailboxesView,
  readingsView: mocks.readingsView,
  whyCantConnect: mocks.whyCantConnect,
  removeMailbox: mocks.removeMailbox,
}));
vi.mock("@/lib/gmail/limits", () => ({ readerReady: mocks.readerReady }));
// The person is in Los Angeles: times are said in their own zone.
vi.mock("@/lib/today", () => ({ timezoneOf: async () => "America/Los_Angeles" }));
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }));

import { GET as connect } from "@/app/api/gmail/connect/route";
import MailboxesPage from "./page";

const mailbox = (over: Partial<MailboxView> = {}): MailboxView => ({
  id: "cmailboxone0000000000000",
  address: "me@example.com",
  status: "active",
  createdAt: ago(30 * DAY_MINUTES),
  agreedAt: ago(30 * DAY_MINUTES),
  lastCheckedAt: ago(60),
  lastErrorCode: null,
  missedAt: null,
  watchExpiresAt: new Date(NOW.getTime() + 5 * DAY_MINUTES * 60_000),
  readings: 0,
  ...over,
});

const reading = (over: Partial<ReadingView> = {}): ReadingView => ({
  id: "creadingone0000000000000",
  mailbox: "me@example.com",
  senderDomain: "power-company.com",
  kind: "bill",
  amountCents: 8_412,
  occursOn: new Date("2026-11-20T00:00:00Z"),
  receivedAt: ago(DAY_MINUTES),
  ...over,
});

// The page's content, rendered as the person would get it. Whatever the page is handed (an
// address bar's search params) never reaches the content.
async function render(props?: unknown): Promise<string> {
  const page = MailboxesPage as (props?: unknown) => ReactElement<{ children: ReactElement }>;
  const content = page(props).props.children;
  const body = await (content.type as (props: unknown) => Promise<ReactElement>)(content.props);
  return renderToStaticMarkup(body);
}

// What the person reads: the markup's words, without React's script for forms sent early.
const words = (html: string) =>
  html
    .replace(/<script>[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1");

// Why someone can't connect, as the page and the connect route both say it.
const CANT_CONNECT: Record<"trial" | "demo", string> = {
  trial: "A sample account can't connect a mailbox.",
  demo: "This account only has the demo bank's sample data, so it can't connect a mailbox. Link your bank or upload a statement first.",
};

const CONNECT_LINK = /href="\/api\/gmail\/connect\?ticket=([^"]+)"/;
const ticketIn = (html: string) => {
  const found = CONNECT_LINK.exec(html)?.[1];
  return found === undefined ? null : decodeURIComponent(found);
};

const LINES = {
  switchedOff:
    "Mailboxes are switched off for now. Jane isn't reading this mailbox. Disconnect to delete what Jane read from it.",
  elsewhere:
    "This mailbox was connected to a different Jane account, so Jane stopped reading it here.",
  reconnect: "Google stopped accepting this connection, so Jane isn't reading this mailbox.",
  paused: "Reading is paused for now.",
  firstRead: `Reading your newest emails from the last ${GMAIL_LIMITS.lookBackDays} days. This takes a minute or two. Come back to this page to see what Jane read.`,
  partRead: "Jane has read part of this mailbox and will read the rest by itself.",
  neverRead: "Jane hasn't been able to read this mailbox yet. It will try again by itself.",
  reader: "Jane isn't reading new email right now. It will carry on by itself. Last read",
  failing: "The last read didn't work; Jane will try again. Last checked",
  arriving: "Reading new email as it arrives. Last checked",
  daily: "Reading new email once a day. Last checked",
};
type Line = keyof typeof LINES;

// Which of the lines the list of mailboxes shows.
const linesIn = (html: string) => {
  const list = words(
    /<section aria-labelledby="your-mailboxes"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "",
  );
  return (Object.keys(LINES) as Line[]).filter((line) => list.includes(LINES[line]));
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("GMAIL_LINK", "1");
  vi.stubEnv("GMAIL_CLIENT_ID", "the-client");
  vi.stubEnv("GMAIL_CLIENT_SECRET", "the-client-secret");
  vi.stubEnv("KILL_BANKS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
  mocks.jar.clear();
  mocks.jar.set("authjs.session-token", SESSION);
  mocks.mailboxesView.mockResolvedValue([]);
  mocks.readingsView.mockResolvedValue({ readings: [], more: false });
  mocks.whyCantConnect.mockResolvedValue(null);
  mocks.readerReady.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("with the switch off", () => {
  beforeEach(() => vi.stubEnv("GMAIL_LINK", ""));

  it("is not found for someone with no mailbox, before anything else is read", async () => {
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(mocks.readingsView).not.toHaveBeenCalled();
    expect(mocks.whyCantConnect).not.toHaveBeenCalled();
  });

  it("still lists a mailbox connected before, with Disconnect and no way to connect", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox(), mailbox({ id: "c2", status: "reconnect" })]);
    mocks.readingsView.mockResolvedValue({ readings: [reading()], more: false });
    const html = await render();
    const text = words(html);
    expect(text).toContain("me@example.com");
    // Every mailbox says so, whatever its state: none can be connected again now.
    expect(text.split(LINES.switchedOff)).toHaveLength(3);
    expect(linesIn(html)).toEqual(["switchedOff"]);
    expect(text).toContain("Yes, disconnect");
    expect(text).toContain("Money emails Jane read");
    expect(html).not.toMatch(/\/api\/gmail\/connect/);
    expect(text).not.toContain("Before you connect");
    expect(text).not.toContain(GMAIL_CONSENT);
    expect(text).not.toContain("forward everything");
    expect(mocks.whyCantConnect).not.toHaveBeenCalled();
  });

  it("says once what disconnecting the last mailbox did, and nothing more", async () => {
    mocks.jar.set(NOTICE_COOKIE, sealNotice(ME, "disconnected_unconfirmed", ago(0.5)));
    const html = await render();
    const text = words(html);
    expect(text).toContain(
      "Disconnected. Jane deleted its own access and what it read from that mailbox. Google didn't confirm that it ended Jane's permission. To be sure, open your Google Account, find Jane under the apps with access, and remove it.",
    );
    expect(text).toContain("Back to settings");
    expect(html).not.toContain('aria-labelledby="your-mailboxes"');
    expect(html).not.toMatch(/\/api\/gmail\/connect/);
    expect(text).not.toContain("Before you connect");
    expect(text).not.toContain("Money emails Jane read");
    expect(mocks.whyCantConnect).not.toHaveBeenCalled();
  });

  it("is still not found from a notice sealed for someone else, too old, or saying connected", async () => {
    for (const value of [
      sealNotice("someone_else", "disconnected", NOW),
      sealNotice(ME, "disconnected", ago(GMAIL_LIMITS.noticeSeconds / 60 + 1)),
      sealNotice(ME, "connected", NOW),
    ]) {
      mocks.jar.set(NOTICE_COOKIE, value);
      await expect(render(), value).rejects.toMatchObject({
        digest: expect.stringContaining("404"),
      });
    }
  });
});

describe("each mailbox's line", () => {
  // Each case also holds what the lines after it test, so the first that applies is the one shown.
  const cases: {
    name: string;
    over: Partial<MailboxView>;
    paused?: boolean;
    readerDown?: boolean;
    line: Line;
  }[] = [
    {
      name: "taken over by another Jane account",
      over: { status: "elsewhere", lastCheckedAt: null, lastErrorCode: "signed_out" },
      paused: true,
      readerDown: true,
      line: "elsewhere",
    },
    {
      name: "Google stopped accepting it",
      over: { status: "reconnect", lastCheckedAt: null, lastErrorCode: "signed_out" },
      paused: true,
      readerDown: true,
      line: "reconnect",
    },
    {
      name: "reading is paused",
      over: { lastCheckedAt: null, agreedAt: ago(1), lastErrorCode: "reader_later" },
      paused: true,
      readerDown: true,
      line: "paused",
    },
    {
      name: "connected minutes ago and not read yet",
      over: { lastCheckedAt: null, agreedAt: ago(GMAIL_LIMITS.firstReadMinutes - 1) },
      line: "firstRead",
    },
    {
      name: "connected minutes ago, some read already and the rest under way",
      over: { lastCheckedAt: null, agreedAt: ago(1), readings: 2 },
      line: "firstRead",
    },
    {
      // Google not sending notices doesn't stop a read.
      name: "connected minutes ago, the watch failed and the first read goes on",
      over: { lastCheckedAt: null, agreedAt: ago(1), lastErrorCode: "watch_failed" },
      line: "firstRead",
    },
    {
      name: "connected minutes ago, Claude stopped the first read after it read some",
      over: { lastCheckedAt: null, agreedAt: ago(1), lastErrorCode: "reader_later", readings: 2 },
      readerDown: true,
      line: "partRead",
    },
    {
      name: "never read through, longer ago, with some read",
      over: { lastCheckedAt: null, agreedAt: ago(GMAIL_LIMITS.firstReadMinutes + 1), readings: 3 },
      line: "partRead",
    },
    {
      // A read stops before it reads anything then, so none is under way.
      name: "connected minutes ago while Claude can't be asked",
      over: { lastCheckedAt: null, agreedAt: ago(GMAIL_LIMITS.firstReadMinutes - 1) },
      readerDown: true,
      line: "neverRead",
    },
    {
      name: "connected minutes ago, the first read failed",
      over: { lastCheckedAt: null, agreedAt: ago(1), lastErrorCode: "http_503" },
      line: "neverRead",
    },
    {
      name: "connected minutes ago, Claude stopped the first read",
      over: { lastCheckedAt: null, agreedAt: ago(1), lastErrorCode: "reader_later" },
      line: "neverRead",
    },
    {
      // Nothing is reading it until the next notice or the daily job.
      name: "connected minutes ago, the first read ran out of time",
      over: { lastCheckedAt: null, agreedAt: ago(1), lastErrorCode: "unfinished" },
      line: "neverRead",
    },
    {
      name: "never read, longer ago than that",
      over: { lastCheckedAt: null, agreedAt: ago(GMAIL_LIMITS.firstReadMinutes + 1) },
      readerDown: true,
      line: "neverRead",
    },
    {
      name: "Claude can't be asked now",
      over: { lastErrorCode: "reader_later" },
      readerDown: true,
      line: "reader",
    },
    {
      name: "the last read failed",
      over: { lastErrorCode: "secrets_unreadable" },
      line: "failing",
    },
    {
      name: "the reader stopped the last read",
      over: { lastErrorCode: "reader_unread" },
      line: "failing",
    },
    { name: "Google sends notices", over: {}, line: "arriving" },
    { name: "Google's notices have ended", over: { watchExpiresAt: ago(1) }, line: "daily" },
    { name: "no notices asked for", over: { watchExpiresAt: null }, line: "daily" },
    {
      name: "the watch failed but the read went on",
      over: { lastErrorCode: "watch_failed", watchExpiresAt: null },
      line: "daily",
    },
    {
      // What it didn't get to is read at the next notice or by the daily job.
      name: "the last read didn't get to everything",
      over: { lastErrorCode: "unfinished" },
      line: "arriving",
    },
    {
      name: "the last read didn't get to everything, and no notices come",
      over: { lastErrorCode: "unfinished", watchExpiresAt: null },
      line: "daily",
    },
  ];

  it.each(cases)("$name: $line", async ({ over, paused, readerDown, line }) => {
    if (paused) vi.stubEnv("KILL_BANKS", "1");
    if (readerDown) mocks.readerReady.mockResolvedValue({ ok: false, why: "everyone" });
    mocks.mailboxesView.mockResolvedValue([mailbox(over)]);
    expect(linesIn(await render())).toEqual([line]);
  });

  it("says when it was last checked, in the person's own time", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox({ lastCheckedAt: ago(60) })]);
    const text = words(await render());
    expect(text).toContain(`Last checked ${momentTimeLabel(ago(60), TIMEZONE)}.`);
    expect(text).not.toMatch(/UTC/);
  });

  it("times the first read from the last time they connected, not the first", async () => {
    mocks.mailboxesView.mockResolvedValue([
      mailbox({ lastCheckedAt: null, createdAt: ago(60 * DAY_MINUTES), agreedAt: ago(2) }),
    ]);
    expect(linesIn(await render())).toEqual(["firstRead"]);
    mocks.mailboxesView.mockResolvedValue([
      mailbox({ lastCheckedAt: null, createdAt: ago(2), agreedAt: ago(60) }),
    ]);
    expect(linesIn(await render())).toEqual(["neverRead"]);
  });

  it("asks whether Claude can be asked only when a line depends on it", async () => {
    mocks.mailboxesView.mockResolvedValue([
      mailbox({ status: "reconnect" }),
      mailbox({ id: "c2", status: "elsewhere" }),
    ]);
    await render();
    vi.stubEnv("KILL_BANKS", "1");
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    await render();
    expect(mocks.readerReady).not.toHaveBeenCalled();
    vi.stubEnv("KILL_BANKS", "");
    mocks.mailboxesView.mockResolvedValue([mailbox({ lastCheckedAt: null, agreedAt: ago(1) })]);
    await render();
    expect(mocks.readerReady).toHaveBeenCalledWith(ME);
  });

  it("adds that emails were missed, for a month after reading lost its place", async () => {
    const missedAt = ago(2 * DAY_MINUTES);
    mocks.mailboxesView.mockResolvedValue([mailbox({ missedAt })]);
    expect(words(await render())).toContain(
      `Jane couldn't read this mailbox for a while, so some emails before ${momentLabel(missedAt, TIMEZONE)} weren't read.`,
    );
    mocks.mailboxesView.mockResolvedValue([
      mailbox({ missedAt: ago((GMAIL_LIMITS.missedShownDays + 1) * DAY_MINUTES) }),
    ]);
    expect(words(await render())).not.toContain("couldn't read this mailbox for a while");
  });

  it("renders a row it doesn't recognize: an unknown state reads as not read yet", async () => {
    mocks.mailboxesView.mockResolvedValue([
      mailbox({ status: null, address: "zqmark planted", lastCheckedAt: ago(5) }),
    ]);
    const html = await render();
    expect(linesIn(html)).toEqual(["neverRead"]);
    expect(words(html)).toContain("zqmark planted");
  });

  it("asks Google to end the permission only for a mailbox Jane still holds", async () => {
    const ASKS = "asks Google to end Jane's permission";
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    expect(words(await render())).toContain(
      "This deletes what Jane read from this mailbox and asks Google to end Jane's permission.",
    );
    for (const status of ["reconnect", "elsewhere"] as const) {
      mocks.mailboxesView.mockResolvedValue([mailbox({ status })]);
      const text = words(await render());
      // Another Jane account may hold it now: what it read for that account stays.
      expect(text).toContain("This deletes what Jane read from this mailbox for this account.");
      expect(text).not.toContain(ASKS);
    }
  });

  it("says a mailbox another account took was connected there, not that it still is", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox({ status: "elsewhere", readings: 2 })]);
    const text = words(await render());
    expect(text).toContain(
      "This mailbox was connected to a different Jane account, so Jane stopped reading it here. What Jane read before is still listed below. If that wasn't you, connect it again, or remove Jane in your Google Account.",
    );
    expect(text).not.toMatch(/is now connected to a different Jane account/);
  });

  it("says what Jane read before is still listed only when it read some", async () => {
    const LISTED = "What Jane read before is still listed below.";
    const SAID: Record<"elsewhere" | "reconnect", readonly [string, string]> = {
      elsewhere: [
        "This mailbox was connected to a different Jane account, so Jane stopped reading it here.",
        "If that wasn't you, connect it again, or remove Jane in your Google Account.",
      ],
      reconnect: [
        "Google stopped accepting this connection, so Jane isn't reading this mailbox. That happens when you change your Google password or take back Jane's permission.",
        "Connect it again to carry on, or disconnect to delete it.",
      ],
    };
    for (const status of ["elsewhere", "reconnect"] as const) {
      const [happened, next] = SAID[status];
      // Stopped before its first read saved anything: the list under it is empty, and says so.
      mocks.mailboxesView.mockResolvedValue([
        mailbox({ status, lastCheckedAt: null, agreedAt: ago(1), readings: 0 }),
      ]);
      mocks.readingsView.mockResolvedValue({ readings: [], more: false });
      let text = words(await render());
      expect(text, status).toContain(`${happened} ${next}`);
      expect(text, status).not.toContain(LISTED);
      expect(text, status).toContain(
        "Nothing here. Jane isn't reading any of these mailboxes right now.",
      );
      // Read from before: the list holds it, and the line says so.
      mocks.mailboxesView.mockResolvedValue([mailbox({ status, readings: 2 })]);
      mocks.readingsView.mockResolvedValue({
        readings: [reading(), reading({ id: "creadingtwo0000000000000" })],
        more: false,
      });
      text = words(await render());
      expect(text, status).toContain(`${happened} ${LISTED} ${next}`);
      expect(text, status).toContain("power-company.com");
    }
  });
});

describe("the Connect link", () => {
  it("follows the words it agrees to, and names the account it connects to", async () => {
    const html = await render();
    const text = words(html);
    expect(text).toContain("You're signed in to Jane as person@jane.test.");
    expect(text).toContain("A mailbox you connect is added to this account.");
    const at = (part: string) => text.indexOf(part);
    for (const bullet of gmailDisclosure()) {
      expect(at(bullet), bullet).toBeGreaterThan(at("Before you connect"));
      expect(at(bullet), bullet).toBeLessThan(at(GMAIL_CONSENT));
    }
    expect(at(GMAIL_CONSENT)).toBeLessThan(at("Agree and connect a Gmail mailbox"));
    // A plain link to the route, never next/link's prefetching one.
    expect(html).toMatch(
      /<a href="\/api\/gmail\/connect\?ticket=[^"]+"[^>]*>Agree and connect a Gmail mailbox<\/a>/,
    );
  });

  it("carries a ticket for this person, in this browser's session, under the words shown", async () => {
    const ticket = ticketIn(await render());
    expect(ticket).not.toBeNull();
    expect(ticketHolds(ticket, { userId: ME, sessionToken: SESSION, now: NOW })).toEqual({
      disclosure: GMAIL_DISCLOSURE_VERSION,
    });
    expect(
      ticketHolds(ticket, { userId: ME, sessionToken: "another-session", now: NOW }),
    ).toBeNull();
    expect(
      ticketHolds(ticket, { userId: "someone_else", sessionToken: SESSION, now: NOW }),
    ).toBeNull();
  });

  it("isn't there before Google is set up", async () => {
    vi.stubEnv("GMAIL_CLIENT_SECRET", "");
    const html = await render();
    expect(ticketIn(html)).toBeNull();
    expect(words(html)).toContain("Connecting isn't set up yet.");
  });

  it.each(Object.entries(CANT_CONNECT))(
    "isn't there for a %s person: one line instead",
    async (why, line) => {
      mocks.whyCantConnect.mockResolvedValue(why);
      const html = await render();
      expect(ticketIn(html)).toBeNull();
      expect(words(html)).toContain(line);
      expect(words(html)).not.toContain(GMAIL_CONSENT);
    },
  );

  it("tells someone with only the demo bank how they can connect, and doesn't call them a sample", async () => {
    mocks.whyCantConnect.mockResolvedValue("demo");
    const text = words(await render());
    expect(text).toContain("Link your bank or upload a statement first.");
    expect(text).not.toContain("A sample account");
  });

  it("isn't there while reading is paused, and Disconnect still is", async () => {
    vi.stubEnv("KILL_BANKS", "1");
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    const html = await render();
    expect(ticketIn(html)).toBeNull();
    const text = words(html);
    expect(text).toContain(
      "Reading is paused for now. Jane isn't reading any mailbox. You can still disconnect.",
    );
    expect(text).toContain("Yes, disconnect");
  });

  it("while paused, offers no Disconnect to someone with no mailbox", async () => {
    vi.stubEnv("KILL_BANKS", "1");
    const html = await render();
    expect(ticketIn(html)).toBeNull();
    const text = words(html);
    expect(text).toContain("Connecting is paused for now. Please try again later.");
    expect(text).not.toContain("You can still disconnect");
  });

  it("stays at the most mailboxes only while one of them can be connected again", async () => {
    const five = (last: Partial<MailboxView>) =>
      Array.from({ length: GMAIL_LIMITS.mailboxesMost }, (_, i) =>
        mailbox({ id: `cmailbox${i}`, address: `box${i}@example.com`, ...(i === 4 ? last : {}) }),
      );
    const AGAIN =
      "You can connect again a mailbox listed below. To add another, disconnect one first.";
    const TOO_MANY = `You've connected ${GMAIL_LIMITS.mailboxesMost} mailboxes, the most Jane reads for one person. Disconnect one to add another.`;

    mocks.mailboxesView.mockResolvedValue(five({}));
    let html = await render();
    expect(ticketIn(html)).toBeNull();
    expect(words(html)).toContain(TOO_MANY);

    for (const status of ["reconnect", "elsewhere"] as const) {
      mocks.mailboxesView.mockResolvedValue(five({ status }));
      html = await render();
      expect(ticketIn(html), status).not.toBeNull();
      expect(words(html)).toContain(AGAIN);
      expect(words(html)).not.toContain(TOO_MANY);
    }

    mocks.mailboxesView.mockResolvedValue(five({}).slice(1));
    html = await render();
    expect(ticketIn(html)).not.toBeNull();
    expect(words(html)).not.toContain(AGAIN);
  });

  it("isn't made without this browser's session", async () => {
    mocks.jar.clear();
    expect(ticketIn(await render())).toBeNull();
  });

  // A page loaded before the account could no longer connect still has a link: the route answers
  // it with the line the page would say now.
  it.each(Object.entries(CANT_CONNECT))(
    "is refused at the route for a %s person in the page's words",
    async (why, line) => {
      mocks.whyCantConnect.mockResolvedValue(why);
      const ticket = encodeURIComponent(makeTicket(ME, SESSION, NOW));
      const answer = await connect(
        new Request(`http://localhost/api/gmail/connect?ticket=${ticket}`),
      );
      expect(answer.status).toBe(403);
      expect(await answer.json()).toEqual({ error: line });
      expect(words(await render())).toContain(line);
    },
  );
});

describe("what just happened", () => {
  const SENTENCES: Record<NoticeWord, string> = {
    connected: "Connected.",
    connected_moved:
      "Connected. This mailbox was connected to another Jane account until now; Jane has stopped reading it there.",
    not_connected:
      "That mailbox wasn't connected. You can try again. If Google now lists Jane under the apps with access to your account, you can remove it there.",
    not_allowed:
      "Google didn't give Jane permission to read that mailbox, so it wasn't connected. You can try again.",
    paused: "Connecting is paused for now. Please try again later.",
    too_many: `You've connected ${GMAIL_LIMITS.mailboxesMost} mailboxes, the most Jane reads for one person. Disconnect one to add another.`,
    start_here:
      "That link didn't start anything. Before you connect a mailbox, check the account named below.",
    disconnected:
      "Disconnected. Jane deleted what it read from that mailbox, and Google ended Jane's permission.",
    disconnected_unconfirmed:
      "Disconnected. Jane deleted its own access and what it read from that mailbox. Google didn't confirm that it ended Jane's permission. To be sure, open your Google Account, find Jane under the apps with access, and remove it.",
    disconnected_no_access:
      "Disconnected. This account had already lost its access to that mailbox, and Jane has deleted what it read from it here. If you didn't connect it to another Jane account, remove Jane in your Google Account.",
  };
  const status = (html: string) => /<p role="status"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
  const said = async () => {
    const found = status(await render());
    return found === null ? null : words(found).trim();
  };

  it.each(Object.entries(SENTENCES))(
    "%s, from a cookie sealed for this person",
    async (word, sentence) => {
      mocks.mailboxesView.mockResolvedValue([mailbox()]);
      mocks.jar.set(NOTICE_COOKIE, sealNotice(ME, word as NoticeWord, ago(0.5)));
      expect(await said()).toBe(sentence);
    },
  );

  it("says nothing without a cookie, or from one sealed for someone else, too old or made up", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    expect(await said()).toBeNull();
    for (const value of [
      sealNotice("someone_else", "disconnected", NOW),
      sealNotice(ME, "disconnected", ago(2)),
      "disconnected",
      "v1.made.up.value",
    ]) {
      mocks.jar.set(NOTICE_COOKIE, value);
      expect(await said(), value).toBeNull();
    }
  });

  it("says the most mailboxes once, when the Connect part already says it", async () => {
    mocks.jar.set(NOTICE_COOKIE, sealNotice(ME, "too_many", NOW));
    mocks.mailboxesView.mockResolvedValue(
      Array.from({ length: GMAIL_LIMITS.mailboxesMost }, (_, i) =>
        mailbox({ id: `cmailbox${i}`, address: `box${i}@example.com` }),
      ),
    );
    expect(words(await render()).split(SENTENCES.too_many)).toHaveLength(2);
  });

  it("says paused once, when the Connect part already says it", async () => {
    vi.stubEnv("KILL_BANKS", "1");
    mocks.jar.set(NOTICE_COOKIE, sealNotice(ME, "paused", NOW));
    expect(words(await render()).split(SENTENCES.paused)).toHaveLength(2);
  });

  it("says connected only while a mailbox is", async () => {
    for (const word of ["connected", "connected_moved"] as const) {
      mocks.jar.set(NOTICE_COOKIE, sealNotice(ME, word, NOW));
      mocks.mailboxesView.mockResolvedValue([mailbox({ status: "reconnect" })]);
      expect(await said(), word).toBeNull();
      mocks.mailboxesView.mockResolvedValue([mailbox()]);
      expect(await said(), word).toBe(SENTENCES[word]);
    }
  });

  it("takes nothing from the address bar", async () => {
    const source = readFileSync("src/app/settings/mailboxes/page.tsx", "utf8");
    expect(source).not.toMatch(/searchParams|\bheaders\(/);
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    const html = await render({
      searchParams: Promise.resolve({ gmail: "connected", notice: "disconnected" }),
    });
    expect(status(html)).toBeNull();
  });
});

describe("money emails Jane read", () => {
  it("lists each with its domain, kind, amount, day and when it arrived, newest first", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    const kinds: [ReadingView["kind"], string][] = [
      ["receipt", "Receipt · Paid Nov 20"],
      ["bill", "Bill · Due Nov 20"],
      ["renewal", "Renewal · Renews Nov 20"],
      ["price_change", "Price change · Changes Nov 20"],
      ["refund", "Refund · Refunded Nov 20"],
      [null, "Other · Nov 20"],
    ];
    mocks.readingsView.mockResolvedValue({
      readings: kinds.map(([kind], i) => reading({ id: `creading${i}`, kind })),
      more: false,
    });
    const text = words(await render());
    for (const [, shown] of kinds) {
      expect(text).toContain(`${shown} · Arrived ${momentLabel(ago(DAY_MINUTES), TIMEZONE)}`);
    }
    expect(text).toContain("power-company.com");
    expect(text).toContain("$84.12");
    // One mailbox: no row says which it came from.
    expect(text).not.toMatch(/Arrived [A-Z][a-z]{2} \d+ · me@example\.com/);
  });

  it("says which mailbox each came from when there are several", async () => {
    mocks.mailboxesView.mockResolvedValue([
      mailbox(),
      mailbox({ id: "c2", address: "work@example.org" }),
    ]);
    mocks.readingsView.mockResolvedValue({
      readings: [reading({ mailbox: "work@example.org" })],
      more: false,
    });
    expect(words(await render())).toMatch(/Arrived [A-Z][a-z]{2} \d+ · work@example\.org/);
  });

  it("leaves out what Claude didn't find", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    mocks.readingsView.mockResolvedValue({
      readings: [reading({ amountCents: null, occursOn: null })],
      more: false,
    });
    const text = words(await render());
    expect(text).toContain(`Bill · Arrived ${momentLabel(ago(DAY_MINUTES), TIMEZONE)}`);
    expect(text).not.toContain("$");
  });

  it("says when there are more than it shows", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    mocks.readingsView.mockResolvedValue({ readings: [reading()], more: true });
    const html = await render();
    expect(words(html)).toContain(
      `Showing the newest ${GMAIL_LIMITS.shownReadings}. The rest are in Download my data.`,
    );
    expect(html).toContain('href="/api/export"');
    mocks.readingsView.mockResolvedValue({ readings: [reading()], more: false });
    expect(words(await render())).not.toContain("Showing the newest");
  });

  it("says why it's empty: still reading, or nothing found yet", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox({ lastCheckedAt: null, agreedAt: ago(1) })]);
    expect(words(await render())).toContain("Nothing yet. Jane is still reading.");
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    expect(words(await render())).toContain(
      "Nothing found yet. New emails about your money will show here after Jane reads them.",
    );
  });

  it("doesn't say it's still reading while Claude can't be asked", async () => {
    mocks.readerReady.mockResolvedValue({ ok: false, why: "person" });
    mocks.mailboxesView.mockResolvedValue([mailbox({ lastCheckedAt: null, agreedAt: ago(1) })]);
    const text = words(await render());
    expect(text).not.toContain("Jane is still reading");
    expect(text).toContain(
      "Nothing found yet. New emails about your money will show here after Jane reads them.",
    );
  });

  it.each(["http_503", "reader_later", "reader_unread", "unfinished"])(
    "doesn't say it's still reading once the first read stopped (%s)",
    async (lastErrorCode) => {
      mocks.mailboxesView.mockResolvedValue([
        mailbox({ lastCheckedAt: null, agreedAt: ago(1), lastErrorCode }),
      ]);
      const text = words(await render());
      expect(text).not.toContain("Jane is still reading");
      expect(text).not.toContain(LINES.firstRead);
    },
  );

  it.each([
    ["Google stopped accepting it", { status: "reconnect" }, false],
    ["another Jane account connected it", { status: "elsewhere" }, false],
    ["reading is paused", {}, true],
  ] as const)("says nothing is being read when no mailbox is: %s", async (_case, over, paused) => {
    if (paused) vi.stubEnv("KILL_BANKS", "1");
    mocks.mailboxesView.mockResolvedValue([
      mailbox({ lastCheckedAt: null, agreedAt: ago(1), ...over }),
    ]);
    const text = words(await render());
    expect(text).toContain("Nothing here. Jane isn't reading any of these mailboxes right now.");
    expect(text).not.toContain("after Jane reads them");
    expect(text).not.toContain("Jane is still reading");
  });

  it("says new emails will show while one of several mailboxes is still read", async () => {
    mocks.mailboxesView.mockResolvedValue([
      mailbox({ status: "reconnect" }),
      mailbox({ id: "c2", address: "work@example.org" }),
    ]);
    const text = words(await render());
    expect(text).toContain(
      "Nothing found yet. New emails about your money will show here after Jane reads them.",
    );
    expect(text).not.toContain("Jane isn't reading any of these mailboxes");
  });

  it("isn't there before a mailbox is connected", async () => {
    expect(words(await render())).not.toContain("Money emails Jane read");
  });

  it("warns that it's read by AI and that an email can lie", async () => {
    mocks.mailboxesView.mockResolvedValue([mailbox()]);
    expect(words(await render())).toContain(
      "Read by AI from your email. It can be wrong and it can miss emails. Jane shows what each email says and the domain it really came from. It can't tell whether the email is honest, so if you don't recognize one, don't pay or call from it.",
    );
  });
});

describe("what the page gives away", () => {
  // Everything at once: a notice, a link, two mailboxes and a reading.
  const full = async () => {
    mocks.jar.set(NOTICE_COOKIE, sealNotice(ME, "connected", NOW));
    mocks.mailboxesView.mockResolvedValue([
      mailbox(),
      mailbox({ id: "c2", address: "work@example.org" }),
    ]);
    mocks.readingsView.mockResolvedValue({ readings: [reading()], more: true });
    return render();
  };

  it("holds no secret, cursor or token, and no sealed value but the link's ticket", async () => {
    const html = await full();
    const ticket = ticketIn(html);
    expect(ticket).not.toBeNull();
    const rest = html.replace(encodeURIComponent(ticket ?? ""), "");
    expect(rest).not.toContain(SESSION);
    expect(rest).not.toContain(createHash("sha256").update(SESSION).digest("base64url"));
    expect(rest).not.toContain(mocks.jar.get(NOTICE_COOKIE));
    // Nothing that looks like a sealed value or a key: a long run of letters and digits with a
    // capital and a digit in it (class names are lower case).
    const tokenLike = (rest.match(/[A-Za-z0-9_-]{20,}/g) ?? []).filter(
      (run) => /[A-Z]/.test(run) && /\d/.test(run),
    );
    expect(tokenLike).toEqual([]);
    expect(rest).not.toMatch(/\bv[12]\.[A-Za-z0-9_-]+\./);
  });

  it("marks every address, sender domain and amount private", async () => {
    const html = await full();
    const outsidePrivate = html.replace(/<(\w+) data-private="[^"]*"[^>]*>[\s\S]*?<\/\1>/g, "");
    for (const value of [
      "me@example.com",
      "work@example.org",
      "person@jane.test",
      "power-company.com",
      "$84.12",
    ]) {
      expect(html, value).toContain(value);
      expect(outsidePrivate, value).not.toContain(value);
    }
  });
});
