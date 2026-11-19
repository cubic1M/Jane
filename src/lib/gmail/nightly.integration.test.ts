import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { FakeGoogle } from "./__fixtures__/fake-google";

// The daily job's choice of mailboxes and its clock, against a real, migrated Postgres and the fake
// Google. No mail here reaches Claude: a read that tried would fail the test (src/test-setup).

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
// No wait between tries, and a run takes at most five mailboxes, so a test can go past it.
vi.mock("@/config/gmail", async (original) => {
  const real = await original<typeof import("@/config/gmail")>();
  return {
    ...real,
    GMAIL_LIMITS: { ...real.GMAIL_LIMITS, callRetryWaitMs: 1, cronMailboxes: 5 },
  };
});
vi.mock("@/lib/ops-alerts", () => ({
  recordOpsEvent: vi.fn(async () => ({ recorded: true, emailed: false })),
}));

import { GMAIL_LIMITS } from "@/config/gmail";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { hit } from "@/lib/rate-limit";
import { systemDb } from "@/lib/system-db";
import { NO_SECRETS, sealSecrets } from "./secrets";
import { refreshAllGmail } from "./sync";

const url = process.env.TEST_DATABASE_URL;
// Years ahead of the real clock: any hit can clear counters more than a day behind it from the
// database the test files share (src/lib/rate-limit.ts), and one of this file's could go mid-test.
const NOW = new Date("2034-11-05T11:15:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const KEY = randomBytes(32).toString("base64");
const TOPIC = "projects/jane-mail/topics/gmail";
const system = () => systemDb("Test: checks which mailboxes the daily job read");

type Fields = Partial<{
  secretsEncrypted: string;
  accessExpiresAt: Date | null;
  status: string;
  watchExpiresAt: Date | null;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  nextTryAt: Date | null;
  syncingSince: Date | null;
  updatedAt: Date;
}>;

describe.runIf(url)("the daily job over Gmail mailboxes", () => {
  let fake: FakeGoogle;
  const people: string[] = [];
  const mailboxes: string[] = [];

  async function person(): Promise<string> {
    const user = await db.user.create({
      data: { email: `gmail-nightly-${randomUUID()}@example.com` },
    });
    people.push(user.id);
    return user.id;
  }

  // A mailbox as connecting leaves one, with notices on for a week, last read an hour ago.
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
        watchExpiresAt: at(7 * DAY),
        lastCheckedAt: at(-HOUR),
        ...fields,
      },
      select: { id: true },
    });
    mailboxes.push(id);
    return { id, address, box, token: tokens.accessToken };
  }

  const nightly = (userIds: string[], options: Parameters<typeof refreshAllGmail>[0] = {}) =>
    refreshAllGmail({ client: db, now: NOW, clock: () => 0, userIds, ...options });
  const rowOf = (id: string) => system().gmailMailbox.findUniqueOrThrow({ where: { id } });
  const checkedAt = async (id: string) => (await rowOf(id)).lastCheckedAt;
  // The mailboxes Google was asked about, in the order the job reached them.
  const reachedOrder = (mailboxes: { token: string }[]) => {
    const firsts = new Map<string, number>();
    fake.requests.forEach((request, index) => {
      if (request.bearer && !firsts.has(request.bearer)) firsts.set(request.bearer, index);
    });
    return mailboxes
      .map((mailbox, index) => ({ index, at: firsts.get(mailbox.token) }))
      .filter((reached): reached is { index: number; at: number } => reached.at !== undefined)
      .sort((a, b) => a.at - b.at)
      .map((reached) => reached.index);
  };

  beforeEach(async () => {
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
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GMAIL_API_URL", fake.origin);
    vi.stubEnv("GMAIL_CLIENT_ID", fake.clientId);
    vi.stubEnv("GMAIL_CLIENT_SECRET", fake.clientSecret);
    vi.stubEnv("GMAIL_PUBSUB_TOPIC", TOPIC);
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation(() => {});
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

  it.each([
    ["switched off", { GMAIL_LINK: "" }],
    ["paused with KILL_BANKS", { KILL_BANKS: "1" }],
  ])("%s, reads nothing and says so", async (_what, env) => {
    const userId = await person();
    await connected(userId, { lastCheckedAt: null });
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    expect(await nightly([userId])).toBeNull();
    expect(fake.requests).toEqual([]);
  });

  it("reads each mailbox that is due, and no other", async () => {
    const userId = await person();
    const due = {
      neverRead: await connected(userId, { lastCheckedAt: null }),
      stale: await connected(userId, { lastCheckedAt: at(-(GMAIL_LIMITS.staleHours + 1) * HOUR) }),
      failing: await connected(userId, { lastErrorCode: "http_503", nextTryAt: at(-MINUTE) }),
      noNotices: await connected(userId, { watchExpiresAt: null }),
    };
    const stale = at(-30 * HOUR);
    const notDue = {
      fresh: await connected(userId),
      waiting: await connected(userId, {
        lastCheckedAt: stale,
        lastErrorCode: "http_503",
        nextTryAt: at(MINUTE),
      }),
      reconnect: await connected(userId, {
        lastCheckedAt: stale,
        status: "reconnect",
        secretsEncrypted: sealSecrets(NO_SECRETS),
      }),
      elsewhere: await connected(userId, {
        lastCheckedAt: stale,
        status: "elsewhere",
        secretsEncrypted: sealSecrets(NO_SECRETS),
      }),
    };
    expect(await nightly([userId])).toEqual({
      read: 4,
      waiting: 0,
      failed: 0,
      reconnect: 0,
      deferred: 0,
    });
    for (const mailbox of Object.values(due)) expect(await checkedAt(mailbox.id)).toEqual(NOW);
    expect(await checkedAt(notDue.fresh.id)).toEqual(at(-HOUR));
    for (const mailbox of [notDue.waiting, notDue.reconnect, notDue.elsewhere]) {
      expect(await checkedAt(mailbox.id)).toEqual(stale);
    }
    expect(reachedOrder(Object.values(notDue))).toEqual([]);
    // The one without notices asked for them again.
    expect(due.noNotices.box.watch).not.toBeNull();
  });

  it("takes up a mailbox the reader stopped, for Claude down or for emails it gave no answer for, once its wait is over", async () => {
    const userId = await person();
    const waited = [
      await connected(userId, { lastErrorCode: "reader_later", nextTryAt: at(-MINUTE) }),
      await connected(userId, { lastErrorCode: "reader_unread", nextTryAt: at(-MINUTE) }),
    ];
    const waiting = [
      await connected(userId, { lastErrorCode: "reader_later", nextTryAt: at(MINUTE) }),
      await connected(userId, { lastErrorCode: "reader_unread", nextTryAt: at(MINUTE) }),
    ];
    expect(await nightly([userId])).toMatchObject({ read: 2, deferred: 0 });
    for (const mailbox of waited) {
      const row = await system().gmailMailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
      expect(row).toMatchObject({ lastCheckedAt: NOW, lastErrorCode: null, nextTryAt: null });
    }
    for (const mailbox of waiting) expect(await checkedAt(mailbox.id)).toEqual(at(-HOUR));
  });

  // Section 17 of the design: a read that didn't get to all its mail says so, and the job takes it.
  it("takes up a mailbox whose last read was unfinished at its next run, and a read that gets through clears it", async () => {
    const userId = await person();
    const { id, box } = await connected(userId, { lastErrorCode: "unfinished" });
    box.deliver({ subject: "Lunch on Friday?", text: "See you there." });
    expect(await nightly([userId])).toMatchObject({ read: 1, failed: 0, deferred: 0 });
    const row = await system().gmailMailbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      historyCursor: box.historyId,
      lastCheckedAt: NOW,
      lastErrorCode: null,
    });
  });

  it("gives a mailbox never read through a whole read's time, so its look-back isn't cut short", async () => {
    // Each call to Google takes this long on the job's clock: in nightMailboxBudgetMs the look-back
    // would get to one email.
    const STEP = 8_000;
    const clock = () => fake.requests.length * STEP;
    const userId = await person();
    const address = `box-${randomUUID()}@fake-mailbox.test`;
    const box = fake.mailbox(address);
    // Recent mail from before it was connected, that isn't about money: none reaches Claude.
    const recent = [1, 2, 3, 4, 5].map((days) =>
      box.deliver({
        subject: `Lunch ${days}?`,
        text: "See you there.",
        receivedAt: at(-days * DAY),
      }),
    );
    const { id } = await connected(userId, { lastCheckedAt: null }, address);
    expect(await nightly([userId], { clock })).toMatchObject({ read: 1, deferred: 0 });
    // One listing of the history, one search, and every recent email looked at: more than
    // nightMailboxBudgetMs would allow.
    expect(fake.fetched("metadata").sort()).toEqual(recent.map((mail) => mail.id).sort());
    expect(fake.requests.length * STEP).toBeGreaterThan(GMAIL_LIMITS.nightMailboxBudgetMs);
    const row = await system().gmailMailbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ lastCheckedAt: NOW, lastErrorCode: null });
  });

  // Section 17 of the design, item 18: a mailbox never read through, or whose last read was
  // unfinished, gets a whole read's runBudgetMs, or waits for a run with that much left.
  describe("a mailbox that needs a whole read", () => {
    // Each call to Google takes this long on the job's clock: in nightMailboxBudgetMs a read lists
    // its history and looks at two emails.
    const STEP = 8_000;
    const slow = () => fake.requests.length * STEP;
    const lunches = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ subject: `Lunch ${n}?`, text: "See you there." }));

    // Never read through, with recent mail from before it was connected that isn't about money: the
    // look-back's, and none of it reaches Claude.
    async function neverRead(userId: string, emails: number, fields: Fields = {}) {
      const address = `box-${randomUUID()}@fake-mailbox.test`;
      const box = fake.mailbox(address);
      const recent = lunches(emails).map(
        (mail, n) => box.deliver({ ...mail, receivedAt: at(-(n + 1) * HOUR) }).id,
      );
      return { ...(await connected(userId, { lastCheckedAt: null, ...fields }, address)), recent };
    }

    it("gets one when its last read was unfinished, so a record twenty seconds can't get through is read through at the next run", async () => {
      const userId = await person();
      const { id, box } = await connected(userId, { lastCheckedAt: at(-25 * HOUR) });
      const start = box.historyId;
      // Five emails in one history record: a read stopped among them leaves the cursor before it.
      const together = box.deliverTogether(lunches(5)).map((mail) => mail.id);
      expect(await nightly([userId], { clock: slow })).toMatchObject({ read: 1, deferred: 0 });
      // Its twenty seconds: the listing and two of the five.
      expect(fake.fetched("metadata")).toEqual(together.slice(0, 2));
      expect(await rowOf(id)).toMatchObject({
        historyCursor: start,
        lastCheckedAt: at(-25 * HOUR),
        lastErrorCode: "unfinished",
      });
      // The next day's run gives it a whole read. With twenty seconds again it would stop at the
      // same place every night.
      expect(await nightly([userId], { now: at(DAY), clock: slow })).toMatchObject({
        read: 1,
        deferred: 0,
      });
      expect(fake.fetched("metadata").slice(2)).toEqual(together);
      expect(await rowOf(id)).toMatchObject({
        historyCursor: box.historyId,
        lastCheckedAt: at(DAY),
        lastErrorCode: null,
      });
    });

    it("waits for the next run when it is the second never read through and less than a whole read is left, and is looked back over then", async () => {
      // A run's budget holds a whole read, so the first mailbox of a run that needs one gets it.
      expect(GMAIL_LIMITS.cronBudgetMs).toBeGreaterThanOrEqual(GMAIL_LIMITS.runBudgetMs);
      const userId = await person();
      const both = [await neverRead(userId, 2), await neverRead(userId, 2)];
      expect(await nightly([userId], { clock: slow })).toEqual({
        read: 1,
        waiting: 0,
        failed: 0,
        reconnect: 0,
        deferred: 1,
      });
      // Neither was ever checked and both were written just now, so either may go first.
      const reached = reachedOrder(both);
      expect(reached).toHaveLength(1);
      const first = both[reached[0]];
      const second = both[1 - reached[0]];
      // The first looked back over all its recent mail, in five calls: forty seconds, which left
      // the second less than a whole read. A look-back started short counts as done however short
      // it is cut, so the second waits instead.
      expect(fake.fetched("metadata").sort()).toEqual(first.recent.sort());
      expect(await rowOf(first.id)).toMatchObject({ lastCheckedAt: NOW, lastErrorCode: null });
      expect(await rowOf(second.id)).toMatchObject({ lastCheckedAt: null, lastErrorCode: null });
      // Never checked, it is first in the next day's run, which looks back over its recent mail.
      expect(await nightly([userId], { now: at(DAY), clock: slow })).toEqual({
        read: 2,
        waiting: 0,
        failed: 0,
        reconnect: 0,
        deferred: 0,
      });
      expect(fake.fetched("metadata")).toEqual(expect.arrayContaining(second.recent));
      expect(await rowOf(second.id)).toMatchObject({ lastCheckedAt: at(DAY), lastErrorCode: null });
    });

    it("waits for the next run when its last read was unfinished and less than a whole read is left after another mailbox", async () => {
      const userId = await person();
      // Checked longest ago, so read first: one new email, three calls, twenty-four seconds, which
      // leave the unfinished one less than a whole read.
      const ordinary = await connected(userId, { lastCheckedAt: at(-30 * HOUR) });
      ordinary.box.deliver(lunches(1)[0]);
      const unfinished = await connected(userId, {
        lastCheckedAt: at(-2 * HOUR),
        lastErrorCode: "unfinished",
      });
      const start = unfinished.box.historyId;
      unfinished.box.deliverTogether(lunches(5));
      expect(await nightly([userId], { clock: slow })).toEqual({
        read: 1,
        waiting: 0,
        failed: 0,
        reconnect: 0,
        deferred: 1,
      });
      expect(reachedOrder([ordinary, unfinished])).toEqual([0]);
      expect(await rowOf(unfinished.id)).toMatchObject({
        historyCursor: start,
        lastCheckedAt: at(-2 * HOUR),
        lastErrorCode: "unfinished",
      });
      // The next day it is the one checked longest ago, so first, with a whole read.
      expect(await nightly([userId], { now: at(DAY), clock: slow })).toMatchObject({
        read: 2,
        deferred: 0,
      });
      expect(await rowOf(unfinished.id)).toMatchObject({
        historyCursor: unfinished.box.historyId,
        lastCheckedAt: at(DAY),
        lastErrorCode: null,
      });
    });

    it("doesn't hold up an ordinary mailbox after it, which is read with what is left", async () => {
      const userId = await person();
      const both = [await neverRead(userId, 1), await neverRead(userId, 1)];
      const ordinary = await connected(userId, { lastCheckedAt: at(-25 * HOUR) });
      const start = ordinary.box.historyId;
      const unreached = ordinary.box.deliver(lunches(1)[0]).id;
      // The first never read through takes thirty-two of the run's forty seconds: a listing, the
      // look-back's search and its one email, and a listing again. The second waits, and the
      // ordinary one has the eight left, less than nightMailboxBudgetMs, for its listing.
      expect(await nightly([userId], { clock: slow, budgetMs: 40_000 })).toEqual({
        read: 2,
        waiting: 0,
        failed: 0,
        reconnect: 0,
        deferred: 1,
      });
      const reached = reachedOrder([...both, ordinary]);
      expect(reached).toHaveLength(2);
      expect(reached[1]).toBe(2);
      const first = both[reached[0]];
      const second = both[1 - reached[0]];
      expect(await checkedAt(first.id)).toEqual(NOW);
      expect(await checkedAt(second.id)).toBeNull();
      // Then the run's time is up, before its email: twenty seconds of its own would have got to it,
      // and every read ends with the run.
      expect(fake.fetched("metadata")).not.toContain(unreached);
      expect(await rowOf(ordinary.id)).toMatchObject({
        historyCursor: start,
        lastCheckedAt: at(-25 * HOUR),
        lastErrorCode: "unfinished",
      });
    });

    it("isn't one with any other code, a failed watch's or a failure's, which gets twenty seconds and is never put off", async () => {
      const userId = await person();
      // Checked longest ago, so read first: one new email, three calls, twenty-four seconds, which
      // leave less than a whole read. A mailbox taken to need one would wait after it.
      const ordinary = await connected(userId, { lastCheckedAt: at(-30 * HOUR) });
      ordinary.box.deliver(lunches(1)[0]);
      const coded = [
        await connected(userId, { lastCheckedAt: at(-3 * HOUR), lastErrorCode: "watch_failed" }),
        await connected(userId, {
          lastCheckedAt: at(-2 * HOUR),
          lastErrorCode: "http_503",
          nextTryAt: at(-MINUTE),
        }),
      ];
      // Five emails in one record each: more than twenty seconds get through.
      const together = coded.map((mailbox) =>
        mailbox.box.deliverTogether(lunches(5)).map((mail) => mail.id),
      );
      expect(await nightly([userId], { clock: slow })).toEqual({
        read: 3,
        waiting: 0,
        failed: 0,
        reconnect: 0,
        deferred: 0,
      });
      // Twenty seconds each, not a whole read: the listing and two of the five.
      for (const ids of together) {
        expect(fake.fetched("metadata").filter((id) => ids.includes(id))).toEqual(ids.slice(0, 2));
      }
    });

    it("goes in turn with another never read through, the one written longest ago first, so one that never gets through doesn't hold the other every night", async () => {
      const userId = await person();
      // Never read through, and stopped every night in a record whose emails take longer than a
      // whole read: last night's read wrote its row. Made first, and with an address that sorts
      // first, so the database's own order would take it first, whether it reads the rows where they
      // lie or by the address index.
      const stuck = await connected(
        userId,
        { lastCheckedAt: null, lastErrorCode: "unfinished", updatedAt: at(-DAY) },
        `a-${randomUUID()}@fake-mailbox.test`,
      );
      const start = stuck.box.historyId;
      stuck.box.deliverTogether(lunches(25));
      // Connected the day before, and put off last night for want of a whole read: untouched since.
      const other = await neverRead(userId, 2, { updatedAt: at(-2 * DAY) });
      expect(await nightly([userId], { clock: slow })).toEqual({
        read: 1,
        waiting: 0,
        failed: 0,
        reconnect: 0,
        deferred: 1,
      });
      // The one that waited is read through, which writes its row, and leaves less than a whole read
      // for the other.
      expect(reachedOrder([stuck, other])).toEqual([1]);
      expect(await rowOf(other.id)).toMatchObject({ lastCheckedAt: NOW, lastErrorCode: null });
      expect((await rowOf(other.id)).updatedAt).not.toEqual(at(-2 * DAY));
      // Put off, the stuck one isn't written: it keeps its turn, ahead of any mailbox read since.
      expect(await rowOf(stuck.id)).toMatchObject({
        historyCursor: start,
        lastCheckedAt: null,
        lastErrorCode: "unfinished",
        updatedAt: at(-DAY),
      });
    });
  });

  it("counts a mailbox whose read broke as failed, says only the error's kind, and goes on to the next", async () => {
    const userId = await person();
    const broken = await connected(userId, { lastCheckedAt: at(-30 * HOUR) });
    const next = await connected(userId, { lastCheckedAt: at(-25 * HOUR) });
    // The database going away as the job takes that mailbox's lock.
    const outage = Object.assign(new Error(`Can't reach the database for ${broken.address}`), {
      name: "PrismaClientInitializationError",
    });
    const failing = db.$extends({
      query: {
        gmailMailbox: {
          async updateMany({ args, query }) {
            if (JSON.stringify(args.where).includes(broken.id)) throw outage;
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const errors = vi.spyOn(log, "error");
    expect(await nightly([userId], { client: failing })).toEqual({
      read: 1,
      waiting: 0,
      failed: 1,
      reconnect: 0,
      deferred: 0,
    });
    expect(await checkedAt(next.id)).toEqual(NOW);
    expect(await checkedAt(broken.id)).toEqual(at(-30 * HOUR));
    expect(errors).toHaveBeenCalledWith("Gmail read broke", {
      kind: "PrismaClientInitializationError",
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain(broken.address);
  });

  it("doesn't take a mailbox for its notices while there are none to ask for", async () => {
    vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
    const userId = await person();
    const { id } = await connected(userId, { watchExpiresAt: null });
    expect(await nightly([userId])).toMatchObject({ read: 0 });
    expect(await checkedAt(id)).toEqual(at(-HOUR));
    expect(fake.requests).toEqual([]);
  });

  it("takes the oldest checked first, never read before all, and no more than cronMailboxes", async () => {
    const userId = await person();
    // Made in an order that isn't the one they are read in.
    const made = [
      await connected(userId, { lastCheckedAt: at(-25 * HOUR) }),
      await connected(userId, { lastCheckedAt: null }),
      await connected(userId, { lastCheckedAt: at(-21 * HOUR) }),
      await connected(userId, { lastCheckedAt: at(-40 * HOUR) }),
      await connected(userId, { lastCheckedAt: at(-30 * HOUR) }),
      await connected(userId, { lastCheckedAt: at(-22 * HOUR) }),
    ];
    expect(GMAIL_LIMITS.cronMailboxes).toBe(5);
    expect(await nightly([userId])).toMatchObject({ read: 5, deferred: 0 });
    expect(reachedOrder(made)).toEqual([1, 3, 4, 0, 5]);
    // The one checked most recently waits for tomorrow, and isn't counted as put off.
    expect(await checkedAt(made[2].id)).toEqual(at(-21 * HOUR));
  });

  it("gives each mailbox no more than nightMailboxBudgetMs, and leaves those past the run's budget for tomorrow", async () => {
    // Each call to Google takes this long on the job's clock.
    const STEP = 8_000;
    const clock = () => fake.requests.length * STEP;
    const userId = await person();
    const busy = await connected(userId, { lastCheckedAt: at(-30 * HOUR) });
    const start = busy.box.historyId;
    // Emails that aren't about money: one call each, and none reaches Claude.
    for (let n = 0; n < 5; n++) {
      busy.box.deliver({ subject: `Lunch ${n}?`, text: "See you there." });
    }
    const quiet = await connected(userId, { lastCheckedAt: at(-25 * HOUR) });
    const late = await connected(userId, { lastCheckedAt: at(-21 * HOUR) });
    expect(await nightly([userId], { clock, budgetMs: 30_000 })).toEqual({
      read: 2,
      waiting: 0,
      failed: 0,
      reconnect: 0,
      deferred: 1,
    });
    // Its own 20 seconds ran out after two emails: history left, so not marked checked.
    const busyRow = await system().gmailMailbox.findUniqueOrThrow({ where: { id: busy.id } });
    expect(GMAIL_LIMITS.nightMailboxBudgetMs).toBe(20_000);
    expect(busyRow.historyCursor).toBe(String(BigInt(start) + BigInt(2)));
    expect(busyRow.lastCheckedAt).toEqual(at(-30 * HOUR));
    // The next got what was left, enough for its one call.
    expect(await checkedAt(quiet.id)).toEqual(NOW);
    expect(await checkedAt(late.id)).toEqual(at(-21 * HOUR));
    expect(reachedOrder([busy, quiet, late])).toEqual([0, 1]);
  });

  it("counts what each read came to, and not one that found the mailbox busy", async () => {
    const userId = await person();
    const counted = await person();
    await hit("gmailReads", counted, { client: db, now: NOW, by: 60 });
    const read = await connected(userId, { lastCheckedAt: null });
    await connected(counted, { lastCheckedAt: null });
    await connected(userId, { lastCheckedAt: null, secretsEncrypted: "planted-text" });
    const gone = await connected(userId, { lastCheckedAt: null });
    fake.takeBack(gone.address);
    const busy = await connected(userId, { lastCheckedAt: null, syncingSince: at(-MINUTE) });
    expect(await nightly([userId, counted])).toEqual({
      read: 1,
      waiting: 1,
      failed: 1,
      reconnect: 1,
      deferred: 0,
    });
    expect(await checkedAt(read.id)).toEqual(NOW);
    expect(await checkedAt(busy.id)).toBeNull();
  });

  it("with no time at all, defers every mailbox due and reads none", async () => {
    const userId = await person();
    await connected(userId, { lastCheckedAt: null });
    await connected(userId, { lastCheckedAt: null });
    expect(await nightly([userId], { budgetMs: 0 })).toEqual({
      read: 0,
      waiting: 0,
      failed: 0,
      reconnect: 0,
      deferred: 2,
    });
    expect(fake.requests).toEqual([]);
  });
});
