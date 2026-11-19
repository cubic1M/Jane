import { randomBytes, randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { FakeGoogle, gmailError } from "./__fixtures__/fake-google";

// Reading a mailbox end to end, against a real, migrated Postgres and the fake Google. Claude is a
// fake whose calls are counted. Nothing here talks to Google or Anthropic.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
// A copy of the limits, without the wait between tries, so one test can shorten the time a request
// gets.
vi.mock("@/config/gmail", async (original) => {
  const real = await original<typeof import("@/config/gmail")>();
  return { ...real, GMAIL_LIMITS: { ...real.GMAIL_LIMITS, callRetryWaitMs: 1 } };
});
// The team's alarms belong to no person: watched here, not left in a table other files count.
vi.mock("@/lib/ops-alerts", () => ({
  recordOpsEvent: vi.fn(async () => ({ recorded: true, emailed: false })),
}));
// The email code as it is: one test makes it throw on one email.
vi.mock("./text", async (original) => {
  const real = await original<typeof import("./text")>();
  return { ...real, htmlToText: vi.fn(real.htmlToText) };
});

import { GMAIL_LIMITS } from "@/config/gmail";
import { db } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { hit } from "@/lib/rate-limit";
import { systemDb } from "@/lib/system-db";
import { countRead } from "./limits";
import { NO_SECRETS, openSecrets, sealSecrets } from "./secrets";
import { syncFromNotice, syncMailbox } from "./sync";
import { htmlToText } from "./text";

const url = process.env.TEST_DATABASE_URL;
// Years ahead of the real clock: any hit can clear counters more than a day behind it from the
// database the test files share (src/lib/rate-limit.ts), and one of this file's could go mid-test.
const NOW = new Date("2034-11-05T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const KEY = randomBytes(32).toString("base64");
const TOPIC = "projects/jane-mail/topics/gmail";
const TRIES = 1 + GMAIL_LIMITS.callRetries;
const limits = GMAIL_LIMITS as { -readonly [K in keyof typeof GMAIL_LIMITS]: number };
const CALL_TIMEOUT_MS = GMAIL_LIMITS.callTimeoutMs;
const system = () => systemDb("Test: checks what a read left behind, across tables");

// Claude, played back. By default it reads the fake's receipt: $42.10, paid Nov 3.
const create = vi.fn();
const claude = (() => ({ messages: { create } })) as never;
const answer = (fields: object) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(fields) }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const RECEIPT = { kind: "receipt", amount: "42.10", date: "2026-11-03" };
const REFUSED = {
  stop_reason: "refusal",
  content: [],
  usage: { input_tokens: 1, output_tokens: 1 },
};
type Sent = { received: string; from: string; subject: string; body: string };
const sentOf = (params: unknown): Sent =>
  JSON.parse((params as { messages: { content: string }[] }).messages[0].content) as Sent;
// What each request to Claude carried.
const sent = (): Sent[] => create.mock.calls.map(([params]) => sentOf(params));

// The place the n-th record after `start` has: each delivery is one record.
const placeAfter = (start: string, n: number) => String(BigInt(start) + BigInt(n));

type Fields = Partial<{
  secretsEncrypted: string;
  accessExpiresAt: Date | null;
  status: string;
  historyCursor: string;
  watchExpiresAt: Date | null;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  nextTryAt: Date | null;
  syncingSince: Date | null;
}>;

describe.runIf(url)("reading a Gmail mailbox", () => {
  let fake: FakeGoogle;
  const people: string[] = [];
  const mailboxes: string[] = [];
  const said: string[] = [];

  async function person({ id, timezone = null }: { id?: string; timezone?: string | null } = {}) {
    const user = await db.user.create({
      data: { ...(id ? { id } : {}), email: `gmail-sync-${randomUUID()}@example.com`, timezone },
    });
    people.push(user.id);
    return user.id;
  }

  // A mailbox as connecting leaves one, with tokens the fake takes, made through scopedFor. Read
  // through an hour ago, so there is no look-back, unless a test says otherwise.
  async function connected(
    userId: string,
    fields: Fields = {},
    address = `box-${randomUUID()}@fake-mailbox.test`,
  ) {
    const tokens = fake.issueTokensForTest(address);
    const box = fake.mailbox(address);
    const { id } = await scopedFor(userId, db).gmailMailboxes.create({
      data: {
        userId,
        address,
        secretsEncrypted: sealSecrets(tokens),
        accessExpiresAt: at(HOUR),
        disclosureVersion: GMAIL_DISCLOSURE_VERSION,
        historyCursor: box.historyId,
        lastCheckedAt: at(-HOUR),
        ...fields,
      },
      select: { id: true },
    });
    mailboxes.push(id);
    return { id, address, box, tokens };
  }

  const sync = (
    userId: string,
    mailboxId: string,
    options: Parameters<typeof syncMailbox>[2] = {},
  ) => syncMailbox(userId, mailboxId, { client: db, now: NOW, clock: () => 0, claude, ...options });
  const rowOf = (id: string) => system().gmailMailbox.findUniqueOrThrow({ where: { id } });
  const readOf = async (mailboxId: string) =>
    (await system().gmailReading.findMany({ where: { mailboxId } }))
      .map((r) => r.messageRef)
      .sort();
  const ids = (...messages: { id: string }[]) => messages.map((m) => m.id).sort();
  const historyAsked = () =>
    fake.requests
      .filter((r) => r.path.endsWith("/history"))
      .map((r) => new URLSearchParams(r.query));
  const auditOf = (mailboxId: string) =>
    system().auditLog.findMany({ where: { targetType: "gmail_mailbox", targetId: mailboxId } });
  // This person's counters, by key, in their current windows.
  const countersOf = async (userId: string) =>
    Object.fromEntries(
      (
        await system().rateLimit.findMany({
          where: { key: { endsWith: `:${userId}` }, windowStart: { lte: NOW } },
          orderBy: { windowStart: "asc" },
        })
      ).map((row) => [row.key, row.count]),
    );

  beforeEach(async () => {
    limits.callTimeoutMs = CALL_TIMEOUT_MS;
    fake = await new FakeGoogle({ now: NOW }).start();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
    vi.stubEnv("GMAIL_LINK", "1");
    vi.stubEnv("KILL_BANKS", "");
    vi.stubEnv("KILL_CLAUDE", "");
    vi.stubEnv("OPS_SWITCHES", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_GMAIL_MODEL", "");
    // Everyone's spend this month is shared with other test files: far out of their reach.
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GMAIL_API_URL", fake.origin);
    vi.stubEnv("GMAIL_CLIENT_ID", fake.clientId);
    vi.stubEnv("GMAIL_CLIENT_SECRET", fake.clientSecret);
    vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
    create.mockResolvedValue(answer(RECEIPT));
    said.length = 0;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });
  afterEach(async () => {
    await fake.stop();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    if (people.length > 0) {
      await system().rateLimit.deleteMany({
        where: { OR: people.map((id) => ({ key: { endsWith: `:${id}` } })) },
      });
    }
    await system().auditLog.deleteMany({
      where: { targetType: "gmail_mailbox", targetId: { in: mailboxes } },
    });
    await system().analyticsEvent.deleteMany({ where: { userId: { in: people } } });
    await system().user.deleteMany({ where: { id: { in: people } } });
  });

  describe("new mail", () => {
    it("is read into a reading of three facts, nothing of the email, and the cursor moves past it", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const message = box.deliver();
      expect(await sync(userId, id)).toBe("read");
      expect(await system().gmailReading.findMany({ where: { mailboxId: id } })).toEqual([
        {
          id: expect.any(String),
          userId,
          mailboxId: id,
          messageRef: message.id,
          receivedAt: new Date("2026-11-03T17:00:00.000Z"),
          senderDomain: "northwind-power.example",
          kind: "receipt",
          amountCents: 4210,
          occursOn: new Date("2026-11-03T00:00:00.000Z"),
          createdAt: expect.any(Date),
        },
      ]);
      expect(await rowOf(id)).toMatchObject({
        historyCursor: box.historyId,
        lastCheckedAt: NOW,
        lastErrorCode: null,
        failures: 0,
        nextTryAt: null,
        syncingSince: null,
      });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("sends Claude the cleaned subject and body, the domain Google checked and the day it arrived, never the mailbox", async () => {
      const userId = await person();
      const { id, address, box } = await connected(userId);
      box.deliver({
        text: "Thanks for your payment of $42.10. Questions? Write to help@northwind-power.example or see https://northwind-power.example/bill?t=secret.",
      });
      await sync(userId, id);
      const [mail] = sent();
      expect(mail).toMatchObject({
        received: "2026-11-03",
        from: "northwind-power.example",
        subject: "Your receipt from Northwind Power",
      });
      expect(mail.body).toContain("$42.10");
      expect(mail.body).toContain("[address]");
      expect(mail.body).toContain("[link]");
      expect(JSON.stringify(sent())).not.toMatch(/secret|help@|https?:/);
      expect(JSON.stringify(create.mock.calls)).not.toContain(address);
    });

    it.each([
      ["America/Los_Angeles", "2026-11-04T03:00:00.000Z", "2026-11-03"],
      ["Asia/Tokyo", "2026-11-03T17:00:00.000Z", "2026-11-04"],
    ])("dates an email by the person's own day (%s)", async (timezone, arrived, day) => {
      const userId = await person({ timezone });
      const { id, box } = await connected(userId);
      box.deliver({ receivedAt: new Date(arrived) });
      expect(await sync(userId, id)).toBe("read");
      expect(sent()[0].received).toBe(day);
      const [reading] = await system().gmailReading.findMany({ where: { mailboxId: id } });
      expect(reading.receivedAt).toEqual(new Date(arrived));
    });

    it("reads every page, saving the cursor after each record as it ends", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      fake.options.historyPageSize = 2;
      const start = box.historyId;
      const messages = [1, 2, 3, 4, 5].map(() => box.deliver());
      const held = fake.hold(`/messages/${messages[3].id}`);
      const reading = sync(userId, id);
      await held.reached;
      // Three records ended before the fourth email was asked for, each saved as it ended.
      expect((await rowOf(id)).historyCursor).toBe(placeAfter(start, 3));
      held.release();
      expect(await reading).toBe("read");
      expect(await readOf(id)).toEqual(ids(...messages));
      expect((await rowOf(id)).historyCursor).toBe(box.historyId);
      // Three pages from one place, then one more listing, which finds nothing.
      expect(historyAsked().map((q) => [q.get("startHistoryId"), q.get("pageToken")])).toEqual([
        [start, null],
        [start, `after-${placeAfter(start, 2)}`],
        [start, `after-${placeAfter(start, 4)}`],
        [placeAfter(start, 5), null],
      ]);
    });

    it("takes the mailbox's place from the answer when it is past the last record, and moves on with nothing new", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      box.deliver();
      box.bump();
      box.bump();
      expect(await sync(userId, id)).toBe("read");
      expect((await rowOf(id)).historyCursor).toBe(box.historyId);
      // A label changed, and nothing arrived: the place moves on all the same.
      box.bump();
      expect(await sync(userId, id, { now: at(MINUTE) })).toBe("read");
      expect((await rowOf(id)).historyCursor).toBe(box.historyId);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("reads an email that two records name once", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const message = box.deliver();
      box.addRecord([message.id]);
      expect(await sync(userId, id)).toBe("read");
      expect(create).toHaveBeenCalledTimes(1);
      expect(fake.fetched("metadata")).toEqual([message.id]);
      expect(await readOf(id)).toEqual([message.id]);
    });

    it("reads each of several emails one record names", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const messages = box.deliverTogether([{}, { subject: "Your bill" }, { subject: "Refund" }]);
      expect(await sync(userId, id)).toBe("read");
      expect(await readOf(id)).toEqual(ids(...messages));
      expect((await rowOf(id)).historyCursor).toBe(box.historyId);
    });

    it("lists once more before it lets go, so the email a notice that found it busy was about is read", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const first = box.deliver();
      const held = fake.hold(`/messages/${first.id}`);
      const reading = sync(userId, id);
      await held.reached;
      const second = box.deliver({ subject: "Your bill from Northwind Power" });
      const asked = fake.requests.length;
      expect(await sync(userId, id, { now: at(1000) })).toBe("busy");
      expect(fake.requests).toHaveLength(asked);
      held.release();
      expect(await reading).toBe("read");
      expect(await readOf(id)).toEqual(ids(first, second));
    });
  });

  describe("the look back over recent mail", () => {
    it("runs while the mailbox has never been read through: its newest emails of the last 14 days, oldest first, then what came after connecting", async () => {
      const userId = await person();
      const address = `box-${randomUUID()}@fake-mailbox.test`;
      const box = fake.mailbox(address);
      box.deliver({ subject: "Your receipt 0", receivedAt: at(-20 * DAY) });
      box.deliver({ subject: "Your receipt 1", receivedAt: at(-3 * DAY) });
      box.deliver({ subject: "Your receipt 2", receivedAt: at(-2 * DAY) });
      const { id } = await connected(userId, { lastCheckedAt: null }, address);
      box.deliver({ subject: "Your receipt 3", receivedAt: at(-HOUR) });
      expect(await sync(userId, id)).toBe("read");
      expect(sent().map((mail) => mail.subject)).toEqual([
        "Your receipt 1",
        "Your receipt 2",
        "Your receipt 3",
      ]);
      const [search] = fake.requests.filter((r) => r.path.endsWith("/messages"));
      expect(Object.fromEntries(new URLSearchParams(search.query))).toEqual({
        q: "newer_than:14d -category:promotions -category:social -category:forums -in:sent -in:drafts",
        maxResults: String(GMAIL_LIMITS.lookBackMessages),
      });
      expect((await rowOf(id)).lastCheckedAt).toEqual(NOW);
    });

    it("doesn't run again once the mailbox has been read through", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      box.deliver();
      expect(await sync(userId, id)).toBe("read");
      expect(fake.requests.filter((r) => r.path.endsWith("/messages"))).toEqual([]);
    });

    it("waits with the mailbox when Claude can't be asked, and runs in the first read that gets through", async () => {
      const userId = await person();
      const { id, box } = await connected(userId, { lastCheckedAt: null });
      box.deliver();
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      expect(await sync(userId, id)).toBe("waiting");
      expect(fake.requests.filter((r) => r.path.endsWith("/messages"))).toEqual([]);
      expect((await rowOf(id)).lastCheckedAt).toBeNull();
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      expect(await sync(userId, id, { now: at(MINUTE) })).toBe("read");
      expect(fake.requests.filter((r) => r.path.endsWith("/messages"))).toHaveLength(1);
      expect((await rowOf(id)).lastCheckedAt).toEqual(at(MINUTE));
    });
  });

  describe("a gap in the history", () => {
    it("jumps to Gmail's place, notes when, tells the team, and looks back over what it can", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      // Arrived yesterday: the look back finds only the last 14 days' mail.
      const lost = [
        box.deliver({ subject: "Your receipt 1", receivedAt: at(-DAY) }),
        box.deliver({ subject: "Bill", receivedAt: at(-DAY) }),
      ];
      box.loseHistory();
      expect(await sync(userId, id)).toBe("read");
      const row = await rowOf(id);
      expect(row).toMatchObject({
        historyCursor: box.historyId,
        missedAt: NOW,
        lastCheckedAt: NOW,
      });
      expect(recordOpsEvent).toHaveBeenCalledWith(
        "gmail_history_gap",
        expect.objectContaining({ userId }),
      );
      expect(await readOf(id)).toEqual(ids(...lost));
    });

    it("fails the read, rather than going round, when Gmail still can't find its place after the jump", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      box.loseHistory();
      fake.answerWith("/history", 404, { times: 5 });
      expect(await sync(userId, id)).toBe("failed");
      expect(await rowOf(id)).toMatchObject({ lastErrorCode: "history_gone", failures: 1 });
      expect(historyAsked()).toHaveLength(2);
    });
  });

  describe("where a read stops", () => {
    it("at the deadline, between records: the cursor at the last one read, lastCheckedAt left alone, and the next read carries on", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      let t = 0;
      create.mockImplementation(async () => {
        t += 60_000;
        return answer(RECEIPT);
      });
      const start = box.historyId;
      const messages = [box.deliver(), box.deliver(), box.deliver()];
      expect(await sync(userId, id, { clock: () => t, budgetMs: 100_000 })).toBe("read");
      expect(create).toHaveBeenCalledTimes(2);
      expect(await rowOf(id)).toMatchObject({
        historyCursor: placeAfter(start, 2),
        lastCheckedAt: at(-HOUR),
        lastErrorCode: null,
      });
      expect(await sync(userId, id, { now: at(MINUTE) })).toBe("read");
      expect(await readOf(id)).toEqual(ids(...messages));
      expect((await rowOf(id)).lastCheckedAt).toEqual(at(MINUTE));
    });

    it("after runMessages emails reach Gmail, the same way", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const start = box.historyId;
      const messages = [box.deliver(), box.deliver(), box.deliver()];
      expect(await sync(userId, id, { runMessages: 2 })).toBe("read");
      expect(await readOf(id)).toEqual(ids(messages[0], messages[1]));
      expect(await rowOf(id)).toMatchObject({
        historyCursor: placeAfter(start, 2),
        lastCheckedAt: at(-HOUR),
      });
    });
  });

  describe("the lock", () => {
    it("lets one read at a time: another finds it busy and asks Google nothing", async () => {
      const userId = await person();
      const { id } = await connected(userId, { syncingSince: at(-MINUTE) });
      expect(await sync(userId, id)).toBe("busy");
      expect(fake.requests).toEqual([]);
      expect((await rowOf(id)).syncingSince).toEqual(at(-MINUTE));
    });

    it("is taken over when a read died holding it, and the read it was taken from writes nothing after", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const message = box.deliver();
      const held = fake.hold(`/messages/${message.id}`);
      const first = sync(userId, id);
      await held.reached;
      const later = at((GMAIL_LIMITS.lockMinutes + 1) * MINUTE);
      expect(await sync(userId, id, { now: later })).toBe("read");
      held.release();
      expect(await first).toBe("none");
      expect(create).toHaveBeenCalledTimes(1);
      expect(await readOf(id)).toEqual([message.id]);
      expect(await rowOf(id)).toMatchObject({ lastCheckedAt: later, syncingSince: null });
    });

    it("is let go only by the read that holds it: one overtaken leaves the newer read's lock alone", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const message = box.deliver();
      const first = fake.hold(`/messages/${message.id}`);
      const overtaken = sync(userId, id);
      await first.reached;
      const second = fake.hold(`/messages/${message.id}`);
      const later = at((GMAIL_LIMITS.lockMinutes + 1) * MINUTE);
      const newer = sync(userId, id, { now: later });
      await second.reached;
      first.release();
      expect(await overtaken).toBe("none");
      expect((await rowOf(id)).syncingSince).toEqual(later);
      second.release();
      expect(await newer).toBe("read");
      expect(await readOf(id)).toEqual([message.id]);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("isn't taken before a failure's wait is over", async () => {
      const userId = await person();
      const { id } = await connected(userId, {
        nextTryAt: at(5 * MINUTE),
        lastErrorCode: "http_503",
      });
      expect(await sync(userId, id)).toBe("backing_off");
      expect(fake.requests).toEqual([]);
      expect(await sync(userId, id, { now: at(6 * MINUTE) })).toBe("read");
    });

    it("isn't taken for a mailbox to connect again, one connected elsewhere, or one that's gone", async () => {
      const userId = await person();
      const wiped = { secretsEncrypted: sealSecrets(NO_SECRETS), accessExpiresAt: null };
      const reconnect = await connected(userId, { ...wiped, status: "reconnect" });
      const elsewhere = await connected(userId, { ...wiped, status: "elsewhere" });
      expect(await sync(userId, reconnect.id)).toBe("reconnect");
      expect(await sync(userId, elsewhere.id)).toBe("none");
      expect(await sync(userId, "no-such-mailbox")).toBe("none");
      // Another person's mailbox, asked for by its id, is no different from one that's gone.
      expect(await sync(await person(), reconnect.id)).toBe("none");
      expect(fake.requests).toEqual([]);
    });
  });

  describe("when Claude can't be asked", () => {
    it("before the read: nothing is read or recorded, nothing backs off, and the token and notices are kept alive", async () => {
      const userId = await person();
      vi.stubEnv("GMAIL_PUBSUB_TOPIC", TOPIC);
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      const { id, box } = await connected(userId, {
        accessExpiresAt: at(30_000),
        watchExpiresAt: null,
      });
      const cursor = box.historyId;
      box.deliver();
      expect(await sync(userId, id)).toBe("waiting");
      expect(fake.requests.map((r) => r.path.split("/").pop())).toEqual(["token", "watch"]);
      const row = await rowOf(id);
      expect(openSecrets(row.secretsEncrypted).accessToken).toBe(fake.requests[1].bearer);
      expect(row).toMatchObject({
        watchExpiresAt: at(7 * DAY),
        historyCursor: cursor,
        lastCheckedAt: at(-HOUR),
        lastErrorCode: null,
        failures: 0,
        nextTryAt: null,
      });
      expect(recordOpsEvent).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("before the read, when the person's count for the day is used up: the same", async () => {
      const userId = await person();
      await hit("gmailReads", userId, { client: db, now: NOW, by: 60 });
      const { id, box } = await connected(userId);
      box.deliver();
      expect(await sync(userId, id)).toBe("waiting");
      expect(historyAsked()).toEqual([]);
      expect(await rowOf(id)).toMatchObject({ lastErrorCode: null, nextTryAt: null });
    });

    it("part way: the count is given back, the read stops after the last record it finished, and tries again in 30 minutes", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const start = box.historyId;
      const first = box.deliver();
      const second = box.deliver({ from: "Shop <orders@shop.example>" });
      create
        .mockResolvedValueOnce(answer(RECEIPT))
        .mockRejectedValueOnce(
          new Anthropic.APIError(503, { type: "error" }, "overloaded", new Headers()),
        );
      expect(await sync(userId, id)).toBe("waiting");
      expect(await rowOf(id)).toMatchObject({
        historyCursor: placeAfter(start, 1),
        nextTryAt: at(GMAIL_LIMITS.readerRetryMinutes * MINUTE),
        lastErrorCode: "reader_later",
        failures: 0,
        lastCheckedAt: at(-HOUR),
      });
      expect(recordOpsEvent).toHaveBeenCalledWith(
        "gmail_reader_down",
        expect.objectContaining({ code: "503" }),
      );
      expect(await auditOf(id)).toEqual([]);
      // Only the email Claude read is counted.
      const counts = await countersOf(userId);
      expect(counts[`gmailReads:${userId}`]).toBe(1);
      expect(counts[`gmailReadsMonth:${userId}`]).toBe(1);
      expect(Object.values(counts).filter((n) => n === 0)).toHaveLength(1);
      expect(await sync(userId, id, { now: at(10 * MINUTE) })).toBe("backing_off");
      expect(await sync(userId, id, { now: at(31 * MINUTE) })).toBe("read");
      expect(await readOf(id)).toEqual(ids(first, second));
      expect(await rowOf(id)).toMatchObject({ lastErrorCode: null, nextTryAt: null });
    });

    it("three emails in a row Claude gave no answer for, from different senders, put the cursor back before the first and stop as if Claude were down", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const start = box.historyId;
      box.deliver({ subject: "Your receipt 0" });
      for (const n of [1, 2, 3]) {
        box.deliver({ from: `Billing <billing@shop${n}.example>`, subject: `Your receipt ${n}` });
      }
      const fifth = box.deliver({ from: "Billing <billing@shop4.example>" });
      create.mockImplementation(async (params: unknown) =>
        sentOf(params).subject === "Your receipt 0" ? answer(RECEIPT) : REFUSED,
      );
      expect(await sync(userId, id)).toBe("waiting");
      expect(await rowOf(id)).toMatchObject({
        historyCursor: placeAfter(start, 1),
        lastErrorCode: "reader_later",
        nextTryAt: at(GMAIL_LIMITS.readerRetryMinutes * MINUTE),
        failures: 0,
      });
      expect(recordOpsEvent).toHaveBeenCalledWith(
        "gmail_reader_down",
        expect.objectContaining({ code: "UNREAD" }),
      );
      expect(fake.fetched("metadata")).not.toContain(fifth.id);
      expect(await system().gmailReading.count({ where: { mailboxId: id } })).toBe(1);
    });

    it("skips emails from one sender it gives no answer for, and the read goes on", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      for (const n of [1, 2, 3]) box.deliver({ subject: `Your receipt ${n}` });
      const last = box.deliver({ from: "Shop <orders@shop.example>", subject: "Your bill" });
      create.mockImplementation(async (params: unknown) =>
        sentOf(params).from === "shop.example" ? answer(RECEIPT) : REFUSED,
      );
      expect(await sync(userId, id)).toBe("read");
      expect(await readOf(id)).toEqual([last.id]);
      expect(await rowOf(id)).toMatchObject({ historyCursor: box.historyId, lastErrorCode: null });
    });

    it("starts the count again after an email it answers", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      for (const n of [1, 2, 3, 4]) {
        box.deliver({ from: `Billing <billing@shop${n}.example>`, subject: `Your receipt ${n}` });
      }
      create.mockImplementation(async (params: unknown) =>
        sentOf(params).from === "shop2.example" ? answer(RECEIPT) : REFUSED,
      );
      expect(await sync(userId, id)).toBe("read");
      expect(create).toHaveBeenCalledTimes(4);
      expect((await rowOf(id)).historyCursor).toBe(box.historyId);
    });
  });

  describe("one email can't stop a mailbox", () => {
    it.each([
      ["a label on the record", { labelIds: ["INBOX", "SPAM"] }, true, false],
      ["a label on the email only", { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }, false, true],
      ["a sender Google didn't vouch for", { authResults: [] }, true, true],
      ["a person's own mailbox", { from: "Sam <sam@gmail.com>" }, true, true],
      ["a sign-in code in the subject", { subject: "Your one-time passcode" }, true, true],
      ["nothing about money", { subject: "Lunch on Friday?", text: "See you there." }, true, true],
      ["too large by Gmail's estimate", { sizeEstimate: 2_000_000 }, true, true],
    ])(
      "%s: never fetched in full or sent to Claude, and the next email is read",
      async (_why, mail, labels, looked) => {
        const userId = await person();
        const { id, box } = await connected(userId);
        const skipped = box.deliver(mail, { labels });
        const next = box.deliver();
        expect(await sync(userId, id)).toBe("read");
        expect(fake.fetched("full")).toEqual([next.id]);
        expect(fake.fetched("metadata").includes(skipped.id)).toBe(looked);
        expect(create).toHaveBeenCalledTimes(1);
        expect(await readOf(id)).toEqual([next.id]);
        expect((await rowOf(id)).historyCursor).toBe(box.historyId);
      },
    );

    it("an email read before isn't fetched in full or sent to Claude again", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const message = box.deliver();
      expect(await sync(userId, id)).toBe("read");
      box.addRecord([message.id]);
      expect(await sync(userId, id, { now: at(MINUTE) })).toBe("read");
      expect(fake.fetched("full")).toEqual([message.id]);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("an email whose body gives a sign-in code is never sent to Claude", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      box.deliver({ text: "Your verification code is 482913.\nTotal: $42.10" });
      const next = box.deliver();
      expect(await sync(userId, id)).toBe("read");
      expect(create).toHaveBeenCalledTimes(1);
      expect(await readOf(id)).toEqual([next.id]);
    });

    it.each([
      [
        "an answer too large to take",
        (box: ReturnType<FakeGoogle["mailbox"]>) =>
          box.deliver({ text: `Total: $42.10 ${"x".repeat(2_100_000)}`, sizeEstimate: 1_000 }),
      ],
      [
        "an answer that isn't a message",
        (box: ReturnType<FakeGoogle["mailbox"]>) => {
          const message = box.deliver();
          fake.answerWith(`/messages/${message.id}`, 200, { body: { id: 7, payload: "none" } });
          return message;
        },
      ],
      [
        "no time it arrived",
        (box: ReturnType<FakeGoogle["mailbox"]>) => box.deliver({ receivedAt: null }),
      ],
      [
        "a time it arrived past what can be saved",
        (box: ReturnType<FakeGoogle["mailbox"]>) =>
          box.deliver({ receivedAt: new Date(Date.UTC(10000, 0, 2)) }),
      ],
      [
        "an email gone before it was asked for",
        (box: ReturnType<FakeGoogle["mailbox"]>) => {
          const message = box.deliver();
          box.remove(message.id);
          return message;
        },
      ],
      [
        "a 400 for that email",
        (box: ReturnType<FakeGoogle["mailbox"]>) => {
          const message = box.deliver();
          fake.answerWith(`/messages/${message.id}`, 400);
          return message;
        },
      ],
      [
        "an email the code throws on",
        (box: ReturnType<FakeGoogle["mailbox"]>) => {
          vi.mocked(htmlToText).mockImplementationOnce(() => {
            throw new RangeError("crafted");
          });
          return box.deliver({ text: "short", html: "<p>Total: <b>$42.10</b></p>" });
        },
      ],
    ])("%s is skipped, and the next email is read", async (_what, make) => {
      const userId = await person();
      const { id, box } = await connected(userId);
      make(box);
      const next = box.deliver();
      expect(await sync(userId, id)).toBe("read");
      expect(await readOf(id)).toEqual([next.id]);
      expect(create).toHaveBeenCalledTimes(1);
      expect(await rowOf(id)).toMatchObject({
        historyCursor: box.historyId,
        lastErrorCode: null,
        failures: 0,
      });
    });

    it("a 503 on one email, after its retries, leaves the cursor before that record, and the next read reads it", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      const start = box.historyId;
      const messages = [box.deliver(), box.deliver(), box.deliver()];
      fake.answerWith(`/messages/${messages[1].id}`, 503, { times: TRIES });
      expect(await sync(userId, id)).toBe("failed");
      expect(await rowOf(id)).toMatchObject({
        historyCursor: placeAfter(start, 1),
        status: "active",
        lastErrorCode: "http_503",
        failures: 1,
        nextTryAt: at(GMAIL_LIMITS.backoffMinutes * MINUTE),
        lastCheckedAt: at(-HOUR),
      });
      expect(fake.fetched("metadata")).not.toContain(messages[2].id);
      const audit = await auditOf(id);
      expect(audit.map((row) => [row.event, row.metadata])).toEqual([
        ["gmail_read_failed", { user_id: userId, code: "http_503", failures: 1 }],
      ]);
      expect(recordOpsEvent).toHaveBeenCalledWith(
        "gmail_read_failed",
        expect.objectContaining({ code: "HTTP_503", userId }),
      );
      expect(
        said.some((line) => line.includes("Gmail read failed") && line.includes("http_503")),
      ).toBe(true);
      expect(await sync(userId, id, { now: at(6 * MINUTE) })).toBe("read");
      expect(await readOf(id)).toEqual(ids(...messages));
      expect(await rowOf(id)).toMatchObject({
        lastErrorCode: null,
        failures: 0,
        nextTryAt: null,
        lastCheckedAt: at(6 * MINUTE),
      });
    });

    it.each([
      [
        "Gmail busy, after its retries",
        (path: string) => fake.answerWith(path, 429, { times: TRIES }),
        "rate_limited",
      ],
      [
        "Gmail's limit, as a 403",
        (path: string) =>
          fake.answerWith(path, 403, { body: gmailError(403, "userRateLimitExceeded") }),
        "rate_limited",
      ],
      [
        "no answer at all, after its retries",
        (path: string) => fake.hangUp(path, TRIES),
        "unreachable",
      ],
      [
        "no answer in time, after its retries",
        (path: string) => {
          // A second for each try, not the ten a request usually gets.
          limits.callTimeoutMs = 1_000;
          for (let n = 0; n < TRIES; n++) fake.hold(path);
        },
        "timeout",
      ],
      [
        "Gmail failing, after its retries",
        (path: string) => fake.answerWith(path, 500, { times: TRIES }),
        "http_500",
      ],
      [
        // Gmail's answer can't be read, not the email: a shape of the email's own is mailMeta's.
        "an answer that isn't JSON",
        (path: string) => fake.answerWith(path, 200, { body: "not a message" }),
        "not_json",
      ],
      [
        "a token turned away twice",
        (path: string) => fake.answerWith(path, 401, { times: 2 }),
        "refused_after_renewal",
      ],
    ])("%s, on one email, ends the read before it as a failure", async (_what, trouble, code) => {
      const userId = await person();
      const { id, box, tokens } = await connected(userId);
      const start = box.historyId;
      const first = box.deliver();
      const second = box.deliver();
      trouble(`/messages/${second.id}`);
      expect(await sync(userId, id)).toBe("failed");
      const row = await rowOf(id);
      expect(row).toMatchObject({
        historyCursor: placeAfter(start, 1),
        status: "active",
        lastErrorCode: code,
        failures: 1,
      });
      expect(openSecrets(row.secretsEncrypted).refreshToken).toBe(tokens.refreshToken);
      expect(await readOf(id)).toEqual([first.id]);
      expect(recordOpsEvent).toHaveBeenCalledWith(
        "gmail_read_failed",
        expect.objectContaining({ code: code.toUpperCase() }),
      );
    });
  });

  describe("tokens", () => {
    it("renews one near its end before reading, saves it at once, and keeps the refresh token Google didn't send again", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId, { accessExpiresAt: at(30_000) });
      expect(await sync(userId, id)).toBe("read");
      const [renewal, history] = fake.requests;
      expect(renewal).toMatchObject({
        path: "/token",
        form: { refresh_token: tokens.refreshToken },
      });
      const row = await rowOf(id);
      const saved = openSecrets(row.secretsEncrypted);
      expect(saved.refreshToken).toBe(tokens.refreshToken);
      expect(saved.accessToken).toBe(history.bearer);
      expect(saved.accessToken).not.toBe(tokens.accessToken);
      expect(row.accessExpiresAt).toEqual(at(3599 * 1000));
    });

    it("renews once when Gmail turns one away, repeats that call, and saves the new one", async () => {
      const userId = await person();
      const { id } = await connected(userId);
      fake.expireAccessTokens();
      expect(await sync(userId, id)).toBe("read");
      expect(fake.requests.map((r) => [r.path.split("/").pop(), r.status])).toEqual([
        ["history", 401],
        ["token", 200],
        ["history", 200],
      ]);
      const saved = openSecrets((await rowOf(id)).secretsEncrypted);
      expect(saved.accessToken).toBe(fake.requests[2].bearer);
    });

    it("keeps the tokens when Gmail turns a new one away too: a failed read with a wait, never 'connect again'", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId);
      fake.answerWith("/history", 401, { times: 2 });
      expect(await sync(userId, id)).toBe("failed");
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: "active", lastErrorCode: "refused_after_renewal" });
      expect(openSecrets(row.secretsEncrypted).refreshToken).toBe(tokens.refreshToken);
      expect((await auditOf(id)).map((a) => a.event)).toEqual(["gmail_read_failed"]);
    });

    it("asks the person to connect again when Google no longer accepts the permission: tokens wiped, said once", async () => {
      const userId = await person();
      const { id, address } = await connected(userId, { watchExpiresAt: at(DAY) });
      fake.takeBack(address);
      expect(await sync(userId, id)).toBe("reconnect");
      const row = await rowOf(id);
      expect(row).toMatchObject({
        status: "reconnect",
        accessExpiresAt: null,
        nextTryAt: null,
        watchExpiresAt: null,
        lastErrorCode: "signed_out",
        syncingSince: null,
      });
      expect(openSecrets(row.secretsEncrypted)).toEqual(NO_SECRETS);
      expect((await auditOf(id)).map((a) => [a.event, a.metadata])).toEqual([
        ["gmail_reconnect_needed", { user_id: userId }],
      ]);
      expect(
        await system().analyticsEvent.count({ where: { userId, name: "gmail_reconnect_needed" } }),
      ).toBe(1);
      const asked = fake.requests.length;
      expect(await sync(userId, id, { now: at(MINUTE) })).toBe("reconnect");
      expect(fake.requests).toHaveLength(asked);
    });

    it("fails the read when Jane's own client is turned away, and never asks the person to connect again", async () => {
      const userId = await person();
      const { id } = await connected(userId, { accessExpiresAt: at(30_000) });
      vi.stubEnv("GMAIL_CLIENT_SECRET", "not-the-secret");
      expect(await sync(userId, id)).toBe("failed");
      expect(await rowOf(id)).toMatchObject({ status: "active", lastErrorCode: "client" });
    });

    it("fails the read when the tokens won't open, and wipes nothing", async () => {
      const userId = await person();
      const { id } = await connected(userId, { secretsEncrypted: "MARKER-planted-text" });
      expect(await sync(userId, id)).toBe("failed");
      expect(await rowOf(id)).toMatchObject({
        status: "active",
        secretsEncrypted: "MARKER-planted-text",
        lastErrorCode: "secrets_unreadable",
        failures: 1,
      });
      expect(fake.requests).toEqual([]);
    });

    it("fails the read with a code of ours when the place isn't Gmail's", async () => {
      const userId = await person();
      const { id } = await connected(userId, { historyCursor: "MARKER-planted-text" });
      expect(await sync(userId, id)).toBe("failed");
      expect(await rowOf(id)).toMatchObject({ lastErrorCode: "bad_cursor", failures: 1 });
      expect(historyAsked()).toEqual([]);
    });

    it("keeps the tokens a reconnect saved while the read was renewing, and the read stops", async () => {
      const userId = await person();
      const { id, address } = await connected(userId, { accessExpiresAt: at(30_000) });
      const held = fake.hold("/token");
      const reading = sync(userId, id);
      await held.reached;
      const reconnected = sealSecrets(fake.issueTokensForTest(address));
      await system().gmailMailbox.update({
        where: { id },
        data: { secretsEncrypted: reconnected },
      });
      held.release();
      expect(await reading).toBe("none");
      expect((await rowOf(id)).secretsEncrypted).toBe(reconnected);
      expect(historyAsked()).toEqual([]);
    });
  });

  describe("Google's notices", () => {
    beforeEach(() => vi.stubEnv("GMAIL_PUBSUB_TOPIC", TOPIC));

    it("are asked for when none are on, for the inbox only, and the end saved", async () => {
      const userId = await person();
      const { id, box } = await connected(userId, { watchExpiresAt: null });
      expect(await sync(userId, id)).toBe("read");
      expect(box.watch).toEqual({
        topicName: TOPIC,
        labelIds: ["INBOX"],
        labelFilterBehavior: "include",
      });
      expect((await rowOf(id)).watchExpiresAt).toEqual(at(7 * DAY));
    });

    it("are asked for again only once fewer than six days are left", async () => {
      const userId = await person();
      const fresh = await connected(userId, { watchExpiresAt: at(6.5 * DAY) });
      const ending = await connected(userId, { watchExpiresAt: at(5 * DAY) });
      await sync(userId, fresh.id);
      await sync(userId, ending.id);
      expect(fresh.box.watch).toBeNull();
      expect(ending.box.watch).not.toBeNull();
      expect((await rowOf(ending.id)).watchExpiresAt).toEqual(at(7 * DAY));
    });

    it("aren't asked for while there is no topic to send them to", async () => {
      vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
      const userId = await person();
      const { id } = await connected(userId, { watchExpiresAt: null });
      expect(await sync(userId, id)).toBe("read");
      expect(fake.requests.filter((r) => r.path.endsWith("/watch"))).toEqual([]);
    });

    it("refused: the read goes on, watch_failed stays and the team hears, until a watch works", async () => {
      const userId = await person();
      const { id, box } = await connected(userId, { watchExpiresAt: null });
      const message = box.deliver();
      fake.answerWith("/watch", 403);
      expect(await sync(userId, id)).toBe("read");
      expect(await readOf(id)).toEqual([message.id]);
      expect(await rowOf(id)).toMatchObject({
        lastErrorCode: "watch_failed",
        watchExpiresAt: null,
        lastCheckedAt: NOW,
        failures: 0,
      });
      expect(recordOpsEvent).toHaveBeenCalledWith(
        "gmail_read_failed",
        expect.objectContaining({ code: "WATCH_FAILED" }),
      );
      expect(await auditOf(id)).toEqual([]);
      expect(await sync(userId, id, { now: at(MINUTE) })).toBe("read");
      expect(await rowOf(id)).toMatchObject({ lastErrorCode: null, watchExpiresAt: at(7 * DAY) });
    });
  });

  describe("the counts", () => {
    it("skip a sender's 16th email of the day, and read another sender's", async () => {
      const userId = await person();
      const { id, box } = await connected(userId);
      for (let n = 0; n < 15; n++) {
        await countRead(userId, "northwind-power.example", { client: db, now: NOW });
      }
      box.deliver();
      const other = box.deliver({ from: "Shop <orders@shop.example>" });
      expect(await sync(userId, id)).toBe("read");
      expect(sent().map((mail) => mail.from)).toEqual(["shop.example"]);
      expect(await readOf(id)).toEqual([other.id]);
      expect((await rowOf(id)).historyCursor).toBe(box.historyId);
    });

    it("end the read as waiting once the person's count runs out part way, with no error code", async () => {
      const userId = await person();
      await hit("gmailReads", userId, { client: db, now: NOW, by: 59 });
      const { id, box } = await connected(userId);
      const start = box.historyId;
      const first = box.deliver();
      box.deliver();
      box.deliver();
      expect(await sync(userId, id)).toBe("waiting");
      expect(await readOf(id)).toEqual([first.id]);
      expect(await rowOf(id)).toMatchObject({
        historyCursor: placeAfter(start, 1),
        lastErrorCode: null,
        nextTryAt: null,
        failures: 0,
        lastCheckedAt: at(-HOUR),
      });
      expect(recordOpsEvent).not.toHaveBeenCalled();
    });
  });

  describe("off, paused, and people who are never read", () => {
    it.each([
      ["switched off", { GMAIL_LINK: "" }],
      ["paused with KILL_BANKS", { KILL_BANKS: "1" }],
    ])("%s: nothing is read, from a notice or by itself", async (_what, env) => {
      const userId = await person();
      const { id, address, box } = await connected(userId);
      box.deliver();
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      expect(await sync(userId, id)).toBe("off");
      expect(await syncFromNotice(address, { client: db, now: NOW, claude })).toBe("off");
      expect(fake.requests).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    });

    it("a trial person is never read, by itself or from a notice", async () => {
      const userId = await person({ id: `trial_${randomUUID()}` });
      const { id, address, box } = await connected(userId);
      box.deliver();
      expect(await sync(userId, id)).toBe("off");
      expect(await syncFromNotice(address, { client: db, now: NOW, claude })).toBe("none");
      expect(fake.requests).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("a notice", () => {
    it("reads the mailbox for the person who holds the address now, and nobody else's", async () => {
      const earlier = await person();
      const holder = await person();
      const address = `box-${randomUUID()}@fake-mailbox.test`;
      const left = await connected(
        earlier,
        { status: "elsewhere", secretsEncrypted: sealSecrets(NO_SECRETS), accessExpiresAt: null },
        address,
      );
      const current = await connected(holder, {}, address);
      const message = current.box.deliver();
      expect(await syncFromNotice(address, { client: db, now: NOW, clock: () => 0, claude })).toBe(
        "read",
      );
      expect(await readOf(current.id)).toEqual([message.id]);
      expect(await readOf(left.id)).toEqual([]);
      expect((await rowOf(left.id)).lastCheckedAt).toEqual(at(-HOUR));
    });

    it("for an address nobody holds reads nothing", async () => {
      const address = `nobody-${randomUUID()}@fake-mailbox.test`;
      expect(await syncFromNotice(address, { client: db, now: NOW, claude })).toBe("none");
      expect(fake.requests).toEqual([]);
    });
  });

  describe("a mailbox taken away while it is read", () => {
    // What connecting the address to another Jane account does to the row it takes it from.
    async function takeOver(mailboxId: string, address: string) {
      await system().gmailMailbox.update({
        where: { id: mailboxId },
        data: {
          status: "elsewhere",
          secretsEncrypted: sealSecrets(NO_SECRETS),
          accessExpiresAt: null,
          watchExpiresAt: null,
        },
      });
      return connected(await person(), {}, address);
    }

    it.each(["disconnected", "taken over"])(
      "%s: no further fetch, no Claude call, no new reading, and nothing recorded",
      async (what) => {
        const userId = await person();
        const { id, address, box } = await connected(userId);
        const first = box.deliver();
        const second = box.deliver();
        const held = fake.hold(`/messages/${second.id}`);
        const reading = sync(userId, id);
        await held.reached;
        const asked = fake.requests.length;
        if (what === "disconnected") {
          await scopedFor(userId, db).gmailMailboxes.deleteMany({ where: { id } });
        } else {
          await takeOver(id, address);
        }
        held.release();
        expect(await reading).toBe("none");
        expect(fake.requests.slice(asked)).toEqual([]);
        expect(create).toHaveBeenCalledTimes(1);
        expect(await system().gmailReading.count({ where: { messageRef: second.id } })).toBe(0);
        expect(await readOf(id)).toEqual(what === "disconnected" ? [] : [first.id]);
        expect(recordOpsEvent).not.toHaveBeenCalled();
        expect(await auditOf(id)).toEqual([]);
      },
    );
  });

  it("says nothing of the address, an email's words or a token in any log line, audit record, ops event or counter", async () => {
    const userId = await person();
    const marker = `MARKER${randomUUID().replaceAll("-", "")}`;
    const { id, address, box, tokens } = await connected(userId, { accessExpiresAt: at(30_000) });
    box.deliver({ subject: `Your receipt ${marker}`, text: `Total: $42.10\n${marker}` });
    create.mockResolvedValue(answer({ ...RECEIPT, note: marker }));
    expect(await sync(userId, id)).toBe("read");
    fake.answerWith("/history", 503, { times: TRIES });
    expect(await sync(userId, id, { now: at(MINUTE) })).toBe("failed");
    const renewed = openSecrets((await rowOf(id)).secretsEncrypted).accessToken ?? "";
    const kept = [
      said.join("\n"),
      JSON.stringify(await auditOf(id)),
      JSON.stringify(vi.mocked(recordOpsEvent).mock.calls.map(([kind, o]) => [kind, o?.code])),
      JSON.stringify(Object.keys(await countersOf(userId))),
      JSON.stringify(await system().gmailReading.findMany({ where: { mailboxId: id } })),
    ].join("\n");
    for (const secret of [address, marker, tokens.accessToken, tokens.refreshToken, renewed]) {
      expect(kept).not.toContain(secret);
    }
    expect(said.some((line) => line.includes("Gmail read") && line.includes('"kept":1'))).toBe(
      true,
    );
  });
});
