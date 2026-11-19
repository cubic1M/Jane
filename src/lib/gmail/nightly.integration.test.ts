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
import { db } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
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

  // A mailbox as connecting leaves one, with notices on for a week, last read `checked` ago.
  async function connected(userId: string, fields: Fields = {}) {
    const address = `box-${randomUUID()}@fake-mailbox.test`;
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
  const checkedAt = async (id: string) =>
    (await system().gmailMailbox.findUniqueOrThrow({ where: { id } })).lastCheckedAt;
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
