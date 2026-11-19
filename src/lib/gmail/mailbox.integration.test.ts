import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

// The mailbox store against a real database and the fake Google: who may connect, saving a
// sign-in with take-over and the cap, what the page is given, and removing, with exactly what
// reaches Google each time, also when the database fails part of the way. Nothing here talks to
// Google.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
// The records a removal writes, as they are, watched, so a test can make one fail.
vi.mock("@/lib/audit", async (original) => {
  const real = await original<typeof import("@/lib/audit")>();
  return { ...real, logAudit: vi.fn(real.logAudit) };
});
vi.mock("@/lib/analytics", async (original) => {
  const real = await original<typeof import("@/lib/analytics")>();
  return { ...real, track: vi.fn(real.track) };
});

import { GMAIL_LIMITS } from "@/config/gmail";
import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { encrypt, keyIdOf } from "@/lib/crypto";
import { exportUserData } from "@/lib/data-export";
import { db } from "@/lib/db";
import { rotateKeys } from "@/lib/key-rotation";
import { systemDb } from "@/lib/system-db";
import { FakeGoogle } from "./__fixtures__/fake-google";
import { getProfile } from "./api";
import {
  heldByAnyone,
  mailboxesView,
  readingsView,
  removeAllMailboxes,
  removeMailbox,
  saveMailbox,
  whyCantConnect,
  type MailboxView,
  type ReadingView,
} from "./mailbox";
import { refreshTokens } from "./oauth";
import { NO_SECRETS, openSecrets, sealSecrets } from "./secrets";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: makes and checks mailboxes across people, and cleans up");
const KEY = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-11-19T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

const MAILBOX_FIELDS: (keyof MailboxView)[] = [
  "address",
  "agreedAt",
  "createdAt",
  "id",
  "lastCheckedAt",
  "lastErrorCode",
  "missedAt",
  "readings",
  "status",
  "watchExpiresAt",
];
const READING_FIELDS: (keyof ReadingView)[] = [
  "amountCents",
  "id",
  "kind",
  "mailbox",
  "occursOn",
  "receivedAt",
  "senderDomain",
];

describe.runIf(url)("the mailbox store", () => {
  let fake: FakeGoogle;
  const people: string[] = [];
  const mailboxIds: string[] = [];

  async function person(id?: string): Promise<string> {
    const user = await db.user.create({
      data: { ...(id ? { id } : {}), email: `gmail-store-${crypto.randomUUID()}@example.com` },
    });
    people.push(user.id);
    return user.id;
  }

  const newAddress = () => `mailbox.${crypto.randomUUID()}@fake-mailbox.test`;

  // A sign-in the fake Google honors, saved for this person as the callback would.
  async function connect(
    userId: string,
    address: string,
    {
      now = NOW,
      expiresAt = new Date(now.getTime() + HOUR),
    }: { now?: Date; expiresAt?: Date } = {},
  ) {
    const tokens = { ...fake.issueTokensForTest(address), expiresAt };
    const saved = await saveMailbox(
      userId,
      {
        address,
        historyId: fake.mailbox(address).historyId,
        tokens,
        disclosureVersion: GMAIL_DISCLOSURE_VERSION,
      },
      { client: db, now },
    );
    if (!("refused" in saved)) mailboxIds.push(saved.id);
    return { saved, tokens };
  }

  async function connected(
    userId: string,
    address: string,
    options?: Parameters<typeof connect>[2],
  ) {
    const { saved, tokens } = await connect(userId, address, options);
    if ("refused" in saved) throw new Error("The mailbox was refused");
    return { ...saved, tokens, address };
  }

  async function addReadings(userId: string, mailboxId: string, times: Date[], kind = "bill") {
    await db.gmailReading.createMany({
      data: times.map((receivedAt) => ({
        userId,
        mailboxId,
        messageRef: `m${crypto.randomUUID().replaceAll("-", "")}`,
        receivedAt,
        senderDomain: "northwind-power.example",
        kind,
        amountCents: 4210,
        occursOn: new Date("2026-11-20T00:00:00.000Z"),
      })),
    });
  }

  const rowOf = (id: string) => system().gmailMailbox.findUnique({ where: { id } });
  const readingsOf = (mailboxId: string) => system().gmailReading.count({ where: { mailboxId } });
  // What the fake Google was asked, in order: the method and the last part of the path.
  const asked = () => fake.requests.map((r) => `${r.method} ${r.path.split("/").at(-1)}`);

  // What the code logs as errors from here to the end of the test, as one text.
  function errorsLogged(): () => string {
    const lines: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args);
    });
    return () => JSON.stringify(lines);
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
    // The fake Google is used only outside production.
    vi.stubEnv("VERCEL_ENV", "");
  });
  afterAll(async () => {
    await system().auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: people } },
          { targetType: "gmail_mailbox", targetId: { in: mailboxIds } },
        ],
      },
    });
    await system().user.deleteMany({ where: { id: { in: people } } });
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    fake = await new FakeGoogle().start();
    vi.stubEnv("GMAIL_API_URL", fake.origin);
    // For a test that renews tokens as a read would.
    vi.stubEnv("GMAIL_CLIENT_ID", fake.clientId);
    vi.stubEnv("GMAIL_CLIENT_SECRET", fake.clientSecret);
  });
  afterEach(async () => {
    await fake.stop();
  });

  describe("who may connect", () => {
    it("refuses a trial person", async () => {
      const userId = await person(`trial_${crypto.randomUUID().replaceAll("-", "")}`);
      expect(await whyCantConnect(userId, { client: db })).toBe("trial");
    });

    it("refuses someone whose only bank is the demo bank", async () => {
      const userId = await person();
      await db.plaidItem.create({
        data: {
          userId,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: encrypt("demo-token"),
        },
      });
      expect(await whyCantConnect(userId, { client: db })).toBe("demo");
    });

    it("welcomes someone with nothing linked yet", async () => {
      expect(await whyCantConnect(await person(), { client: db })).toBeNull();
    });
  });

  describe("saving a sign-in", () => {
    it("saves a new mailbox: active, its tokens sealed, reading's place where the mailbox is now", async () => {
      const userId = await person();
      const address = newAddress();
      const saved = await connected(userId, address);
      expect(saved).toMatchObject({ reconnected: false, tookOver: false });
      const row = await system().gmailMailbox.findUniqueOrThrow({ where: { id: saved.id } });
      expect(row).toMatchObject({
        userId,
        address,
        status: "active",
        historyCursor: fake.mailbox(address).historyId,
        accessExpiresAt: saved.tokens.expiresAt,
        disclosureVersion: GMAIL_DISCLOSURE_VERSION,
        agreedAt: NOW,
        createdAt: NOW,
        failures: 0,
        nextTryAt: null,
        lastErrorCode: null,
        watchExpiresAt: null,
        lastCheckedAt: null,
        missedAt: null,
        syncingSince: null,
      });
      expect(openSecrets(row.secretsEncrypted)).toEqual({
        accessToken: saved.tokens.accessToken,
        refreshToken: saved.tokens.refreshToken,
      });
      expect(row.secretsEncrypted).not.toContain(saved.tokens.refreshToken);
      expect(fake.requests).toEqual([]);
    });

    it("keeps an address in lowercase, so capitals can't make a second holder", async () => {
      const [first, second] = [await person(), await person()];
      const address = newAddress();
      await connected(first, address);
      const taken = await connected(second, address.toUpperCase());
      expect(taken.tookOver).toBe(true);
      expect((await rowOf(taken.id))?.address).toBe(address);
      expect(await system().gmailMailbox.count({ where: { address, status: "active" } })).toBe(1);
    });

    it("connecting again resets exactly what a sign-in sets, keeps reading's place and leaves a running read alone", async () => {
      const userId = await person();
      const address = newAddress();
      const first = await connected(userId, address);
      const worn = {
        status: "reconnect",
        // Not a sealed value: connecting again would fail here if it opened the old one.
        secretsEncrypted: "planted, and never opened",
        accessExpiresAt: null,
        failures: 4,
        nextTryAt: at(60),
        lastErrorCode: "signed_out",
        watchExpiresAt: at(5 * 24 * 60),
        historyCursor: "9007199254741234",
        syncingSince: at(-1),
        lastCheckedAt: at(-120),
        missedAt: at(-24 * 60),
        disclosureVersion: "2026-01-01",
        agreedAt: at(-30 * 24 * 60),
      };
      await system().gmailMailbox.update({ where: { id: first.id }, data: worn });
      fake.mailbox(address).bump();
      const later = at(24 * 60);
      const again = await connected(userId, address, { now: later });
      expect(again).toMatchObject({ id: first.id, reconnected: true, tookOver: false });
      const row = await system().gmailMailbox.findUniqueOrThrow({ where: { id: first.id } });
      expect(row).toMatchObject({
        status: "active",
        accessExpiresAt: again.tokens.expiresAt,
        disclosureVersion: GMAIL_DISCLOSURE_VERSION,
        agreedAt: later,
        failures: 0,
        nextTryAt: null,
        lastErrorCode: null,
        watchExpiresAt: null,
        // Untouched by a sign-in:
        historyCursor: worn.historyCursor,
        syncingSince: worn.syncingSince,
        lastCheckedAt: worn.lastCheckedAt,
        missedAt: worn.missedAt,
        createdAt: NOW,
        address,
        userId,
      });
      expect(openSecrets(row.secretsEncrypted)).toEqual({
        accessToken: again.tokens.accessToken,
        refreshToken: again.tokens.refreshToken,
      });
    });

    it("a second person connecting the address takes it over: the earlier copy stops and keeps its readings, and no one else's rows change", async () => {
      const [earlier, newer, bystander] = [await person(), await person(), await person()];
      const address = newAddress();
      const held = await connected(earlier, address);
      await system().gmailMailbox.update({
        where: { id: held.id },
        data: { watchExpiresAt: at(6 * 24 * 60) },
      });
      await addReadings(earlier, held.id, [NOW, at(-60)]);
      const earlierBefore = await system().gmailMailbox.findUniqueOrThrow({
        where: { id: held.id },
      });
      // The bystander has a mailbox of their own, and an old copy of this address that Google
      // stopped accepting.
      await connected(bystander, newAddress());
      const old = await db.gmailMailbox.create({
        data: {
          userId: bystander,
          address,
          secretsEncrypted: sealSecrets(NO_SECRETS),
          status: "reconnect",
          disclosureVersion: GMAIL_DISCLOSURE_VERSION,
          historyCursor: "1",
        },
      });
      mailboxIds.push(old.id);
      const bystanderRows = () =>
        system().gmailMailbox.findMany({ where: { userId: bystander }, orderBy: { id: "asc" } });
      const bystanderBefore = await bystanderRows();

      const taken = await connected(newer, address);

      expect(taken).toMatchObject({ reconnected: false, tookOver: true });
      const earlierRow = await system().gmailMailbox.findUniqueOrThrow({ where: { id: held.id } });
      expect(earlierRow).toMatchObject({
        status: "elsewhere",
        accessExpiresAt: null,
        watchExpiresAt: null,
        historyCursor: earlierBefore.historyCursor,
        lastCheckedAt: earlierBefore.lastCheckedAt,
      });
      expect(openSecrets(earlierRow.secretsEncrypted)).toEqual({
        accessToken: null,
        refreshToken: null,
      });
      expect(await readingsOf(held.id)).toBe(2);
      expect(await bystanderRows()).toEqual(bystanderBefore);
      expect(
        await system().gmailMailbox.findMany({
          where: { address, status: "active" },
          select: { userId: true },
        }),
      ).toEqual([{ userId: newer }]);
      const audits = await system().auditLog.findMany({
        where: { event: "gmail_taken_over", targetId: held.id },
      });
      expect(audits).toHaveLength(1);
      // The system's record, naming the earlier holder and only them: who connected it is in their
      // own gmail_connected record.
      expect(audits[0]).toMatchObject({
        actorType: "system",
        actorId: null,
        targetType: "gmail_mailbox",
      });
      expect(audits[0]?.metadata).toEqual({ user_id: earlier });
      expect(JSON.stringify(audits)).not.toContain(newer);
      expect(JSON.stringify(audits)).not.toContain(address);
      expect(JSON.stringify(audits)).not.toMatch(/fake-access|fake-refresh/);
      expect(fake.requests).toEqual([]);
    });

    it("keeps the take-over out of the new holder's own records: their Download my data names no one who held it before", async () => {
      const [earlier, newer] = [await person(), await person()];
      const address = newAddress();
      const held = await connected(earlier, address);
      const taken = await connected(newer, address);
      expect(taken.tookOver).toBe(true);

      const theirs = JSON.stringify(await exportUserData(newer, { client: db, now: NOW }));

      // Their own mailbox is in it, and nothing of the earlier holder's.
      expect(theirs).toContain(taken.id);
      expect(theirs).not.toContain(earlier);
      expect(theirs).not.toContain(held.id);
    });

    it("two people saving one address at the same moment leave exactly one active row", async () => {
      for (let round = 0; round < 3; round++) {
        const [one, two] = [await person(), await person()];
        const address = newAddress();
        const both = await Promise.all([connected(one, address), connected(two, address)]);
        const rows = await system().gmailMailbox.findMany({
          where: { address },
          select: { status: true },
        });
        expect(rows.map((row) => row.status).sort()).toEqual(["active", "elsewhere"]);
        expect(both.filter((saved) => saved.tookOver)).toHaveLength(1);
      }
    });

    it("one person saving one address twice at once keeps one row", async () => {
      const userId = await person();
      const address = newAddress();
      const both = await Promise.all([connected(userId, address), connected(userId, address)]);
      expect(both[0].id).toBe(both[1].id);
      expect(both.map((saved) => saved.reconnected).sort()).toEqual([false, true]);
      expect(await system().gmailMailbox.count({ where: { userId } })).toBe(1);
    });

    it("refuses a new address at the cap and writes nothing, and still lets one they have connect again", async () => {
      const [userId, holder] = [await person(), await person()];
      const addresses = Array.from({ length: GMAIL_LIMITS.mailboxesMost }, newAddress);
      const firstId = (await connected(userId, addresses[0])).id;
      for (const address of addresses.slice(1)) await connected(userId, address);
      const address = newAddress();
      const held = await connected(holder, address);
      const heldBefore = await rowOf(held.id);

      const refused = await connect(userId, address);

      expect(refused.saved).toEqual({ refused: "too_many" });
      expect(await system().gmailMailbox.count({ where: { userId } })).toBe(
        GMAIL_LIMITS.mailboxesMost,
      );
      expect(await rowOf(held.id)).toEqual(heldBefore);
      expect(
        await system().auditLog.count({ where: { event: "gmail_taken_over", targetId: held.id } }),
      ).toBe(0);
      // A mailbox Google stopped accepting connects again at the cap.
      await system().gmailMailbox.update({
        where: { id: firstId },
        data: { status: "reconnect", secretsEncrypted: sealSecrets(NO_SECRETS) },
      });
      const again = await connected(userId, addresses[0]);
      expect(again).toMatchObject({ id: firstId, reconnected: true, tookOver: false });
      expect((await rowOf(firstId))?.status).toBe("active");
    });

    it("counts a mailbox as held only while a row of it is active", async () => {
      const userId = await person();
      const address = newAddress();
      expect(await heldByAnyone(address, { client: db })).toBe(false);
      const { id } = await connected(userId, address);
      expect(await heldByAnyone(address, { client: db })).toBe(true);
      expect(await heldByAnyone(address.toUpperCase(), { client: db })).toBe(true);
      for (const status of ["reconnect", "elsewhere"]) {
        await system().gmailMailbox.update({ where: { id }, data: { status } });
        expect(await heldByAnyone(address, { client: db })).toBe(false);
      }
    });
  });

  describe("what the page is given", () => {
    it("lists a person's mailboxes in the order connected, with only what the page shows: never the tokens or reading's place", async () => {
      const [userId, other] = [await person(), await person()];
      const first = await connected(userId, newAddress());
      const second = await connected(userId, newAddress(), { now: at(1) });
      // Connected again later: it keeps its place in the list, and the page is told when.
      const again = await connected(userId, first.address, { now: at(2) });
      await connected(other, newAddress());
      await system().gmailMailbox.update({
        where: { id: first.id },
        data: { lastCheckedAt: at(60), lastErrorCode: "watch_failed", missedAt: at(-60) },
      });

      const view = await mailboxesView(userId, { client: db });

      expect(view.map((mailbox) => mailbox.id)).toEqual([first.id, second.id]);
      for (const mailbox of view) expect(Object.keys(mailbox).sort()).toEqual(MAILBOX_FIELDS);
      expect(view[0]).toEqual({
        id: first.id,
        address: first.address,
        status: "active",
        createdAt: NOW,
        agreedAt: at(2),
        lastCheckedAt: at(60),
        lastErrorCode: "watch_failed",
        missedAt: at(-60),
        watchExpiresAt: null,
        readings: 0,
      });
      const shown = JSON.stringify(view);
      for (const row of await system().gmailMailbox.findMany({ where: { userId } })) {
        expect(shown).not.toContain(row.secretsEncrypted);
        expect(shown).not.toContain(row.historyCursor);
      }
      for (const { tokens } of [first, second, again]) {
        expect(shown).not.toContain(tokens.accessToken);
        expect(shown).not.toContain(tokens.refreshToken);
      }
    });

    it("lists the newest money emails, at most the page's number, with the mailbox each came from", async () => {
      const [userId, other] = [await person(), await person()];
      const one = await connected(userId, newAddress());
      const two = await connected(userId, newAddress());
      const most = GMAIL_LIMITS.shownReadings;
      // One more than is shown, a minute apart, taking turns between the two mailboxes.
      const minutesAgo = Array.from({ length: most + 1 }, (_, i) => at(-i));
      await addReadings(
        userId,
        one.id,
        minutesAgo.filter((_, i) => i % 2 === 0),
      );
      await addReadings(
        userId,
        two.id,
        minutesAgo.filter((_, i) => i % 2 === 1),
      );
      const theirs = await connected(other, newAddress());
      await addReadings(other, theirs.id, [at(60)]);

      const { readings, more } = await readingsView(userId, { client: db });

      expect(more).toBe(true);
      expect(readings.map((reading) => reading.receivedAt)).toEqual(minutesAgo.slice(0, most));
      for (const reading of readings) expect(Object.keys(reading).sort()).toEqual(READING_FIELDS);
      expect(readings[0]).toMatchObject({
        mailbox: one.address,
        senderDomain: "northwind-power.example",
        kind: "bill",
        amountCents: 4210,
        occursOn: new Date("2026-11-20T00:00:00.000Z"),
      });
      expect(readings[1]?.mailbox).toBe(two.address);
      // Exactly the page's number: nothing more to say.
      await system().gmailReading.deleteMany({
        where: { mailboxId: one.id, receivedAt: minutesAgo[most] },
      });
      expect(await readingsView(userId, { client: db })).toMatchObject({ more: false });
    });

    it("counts each mailbox's money emails, all of them, not only the newest the page lists", async () => {
      const [userId, other] = [await person(), await person()];
      const busy = await connected(userId, newAddress());
      const quiet = await connected(userId, newAddress(), { now: at(1) });
      const none = await connected(userId, newAddress(), { now: at(2) });
      const most = GMAIL_LIMITS.shownReadings;
      await addReadings(
        userId,
        busy.id,
        Array.from({ length: most + 1 }, (_, i) => at(-i)),
      );
      await addReadings(userId, quiet.id, [at(-24 * 60), at(-25 * 60)]);
      const theirs = await connected(other, newAddress());
      await addReadings(other, theirs.id, [at(60), at(61)]);

      const view = await mailboxesView(userId, { client: db });

      expect(view.map(({ id, readings }) => ({ id, readings }))).toEqual([
        { id: busy.id, readings: most + 1 },
        { id: quiet.id, readings: 2 },
        { id: none.id, readings: 0 },
      ]);
      // The page's list holds only the newest, every one from the busy mailbox: the count is what
      // says the quiet one was read.
      const { readings } = await readingsView(userId, { client: db });
      expect(readings.filter((reading) => reading.mailbox === quiet.address)).toEqual([]);
    });

    it("shows and removes a row planted with marker words, as the access proof plants it, sending nothing", async () => {
      const userId = await person();
      const marker = `proof-marker-${crypto.randomUUID()}`;
      const planted = await db.gmailMailbox.create({
        data: {
          userId,
          address: marker,
          secretsEncrypted: marker,
          status: marker,
          disclosureVersion: marker,
          historyCursor: marker,
        },
      });
      mailboxIds.push(planted.id);
      await addReadings(userId, planted.id, [NOW], marker);

      const [mailbox] = await mailboxesView(userId, { client: db });
      const { readings } = await readingsView(userId, { client: db });

      expect(mailbox).toMatchObject({ id: planted.id, status: null });
      expect(readings).toHaveLength(1);
      expect(readings[0]).toMatchObject({ kind: null });
      // The page gets the words only as the mailbox's own address: never as a state, a kind, a
      // place or a sealed value.
      const { address, ...restOfMailbox } = mailbox;
      const { mailbox: from, ...restOfReading } = readings[0];
      expect([address, from]).toEqual([marker, marker]);
      expect(JSON.stringify([restOfMailbox, restOfReading])).not.toContain(marker);
      expect(await removeMailbox(userId, planted.id, "user_disconnected", { client: db })).toEqual({
        endedAtGoogle: false,
        hadAccess: false,
      });
      expect(await rowOf(planted.id)).toBeNull();
      expect(fake.requests).toEqual([]);
    });
  });

  describe("removing a mailbox", () => {
    it("deletes it and what was read, stops notices, and ends the permission at Google", async () => {
      const userId = await person();
      const { id, address, tokens } = await connected(userId, newAddress());
      await addReadings(userId, id, [NOW, at(-60)]);

      const removed = await removeMailbox(userId, id, "user_disconnected", {
        client: db,
        now: NOW,
      });

      expect(removed).toEqual({ endedAtGoogle: true, hadAccess: true });
      expect(await rowOf(id)).toBeNull();
      expect(await readingsOf(id)).toBe(0);
      expect(asked()).toEqual(["POST stop", "POST revoke"]);
      expect(fake.requests[0]?.bearer).toBe(tokens.accessToken);
      expect(fake.revokedTokens).toEqual([tokens.refreshToken]);
      expect(fake.stopped).toEqual([address]);
      const audit = await system().auditLog.findFirstOrThrow({
        where: { event: "gmail_disconnected", targetId: id },
      });
      expect(audit).toMatchObject({
        actorType: "user",
        actorId: userId,
        targetType: "gmail_mailbox",
      });
      expect(audit.metadata).toMatchObject({
        user_id: userId,
        reason: "user_disconnected",
        ended_at_google: true,
      });
      const tracked = await system().analyticsEvent.findMany({
        where: { userId, name: "gmail_disconnected" },
      });
      expect(tracked.map((event) => event.properties)).toEqual([{ reason: "user_disconnected" }]);
      const recorded = JSON.stringify([audit, tracked]);
      expect(recorded).not.toContain(address);
      expect(recorded).not.toContain(tokens.accessToken);
      expect(recorded).not.toContain(tokens.refreshToken);
    });

    it("sends no stop with an access token past its time, only the end of the permission", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId, newAddress(), { expiresAt: at(-1) });
      expect(
        await removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW }),
      ).toEqual({ endedAtGoogle: true, hadAccess: true });
      expect(asked()).toEqual(["POST revoke"]);
      expect(fake.revokedTokens).toEqual([tokens.refreshToken]);
    });

    it("still deletes it and what was read when Google refuses, and doesn't say the permission ended", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId, newAddress());
      await addReadings(userId, id, [NOW]);
      fake.answerWith("revoke", 503);

      expect(
        await removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW }),
      ).toEqual({ endedAtGoogle: false, hadAccess: true });

      expect(await rowOf(id)).toBeNull();
      expect(await readingsOf(id)).toBe(0);
      // Asked once, and not again.
      expect(asked()).toEqual(["POST stop", "POST revoke"]);
      expect(fake.requests.at(-1)?.form.token).toBe(tokens.refreshToken);
      const audit = await system().auditLog.findFirstOrThrow({
        where: { event: "gmail_disconnected", targetId: id },
      });
      expect(audit.metadata).toMatchObject({ ended_at_google: false });
    });

    it("has deleted it before Google answers, so a slow Google can't keep it", async () => {
      const userId = await person();
      const { id } = await connected(userId, newAddress());
      await addReadings(userId, id, [NOW]);
      const held = fake.hold("revoke");

      const removing = removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW });
      await held.reached;
      const whileGoogleWaits = { row: await rowOf(id), readings: await readingsOf(id) };
      held.release();
      // Finished before anything is checked, so a failure here can't leave it writing after the
      // clean-up.
      const removed = await removing;

      expect(whileGoogleWaits).toEqual({ row: null, readings: 0 });
      expect(removed).toEqual({ endedAtGoogle: true, hadAccess: true });
    });

    it("ends the permission with the access token when there is no refresh token", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId, newAddress());
      await system().gmailMailbox.update({
        where: { id },
        data: {
          secretsEncrypted: sealSecrets({ accessToken: tokens.accessToken, refreshToken: null }),
        },
      });

      expect(
        await removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW }),
      ).toEqual({ endedAtGoogle: true, hadAccess: true });

      expect(asked()).toEqual(["POST stop", "POST revoke"]);
      expect(fake.revokedTokens).toEqual([tokens.accessToken]);
    });

    it("works with the switch off and while reading is paused", async () => {
      vi.stubEnv("GMAIL_LINK", "");
      vi.stubEnv("KILL_BANKS", "1");
      try {
        const userId = await person();
        const { id, tokens } = await connected(userId, newAddress());
        expect(
          await removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW }),
        ).toEqual({ endedAtGoogle: true, hadAccess: true });
        expect(await rowOf(id)).toBeNull();
        expect(fake.revokedTokens).toEqual([tokens.refreshToken]);
      } finally {
        vi.stubEnv("KILL_BANKS", "");
      }
    });

    it("deletes a mailbox whose sealed value won't open, and sends nothing", async () => {
      const userId = await person();
      const { id } = await connected(userId, newAddress());
      await system().gmailMailbox.update({
        where: { id },
        data: { secretsEncrypted: "planted-marker-text" },
      });

      expect(
        await removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW }),
      ).toEqual({ endedAtGoogle: false, hadAccess: true });

      expect(await rowOf(id)).toBeNull();
      expect(fake.requests).toEqual([]);
      const audit = await system().auditLog.findFirstOrThrow({
        where: { event: "gmail_disconnected", targetId: id },
      });
      expect(audit.metadata).toMatchObject({ ended_at_google: false });
    });

    it("removes a mailbox Google stopped accepting, or one moved to another account, sending nothing", async () => {
      const userId = await person();
      for (const status of ["reconnect", "elsewhere"]) {
        const { id } = await connected(userId, newAddress());
        await system().gmailMailbox.update({
          where: { id },
          data: { status, secretsEncrypted: sealSecrets(NO_SECRETS), accessExpiresAt: null },
        });
        expect(
          await removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW }),
        ).toEqual({ endedAtGoogle: false, hadAccess: false });
        expect(await rowOf(id)).toBeNull();
      }
      expect(fake.requests).toEqual([]);
    });

    it("leaves the permission at Google while another active row still holds the address", async () => {
      const [userId, other] = [await person(), await person()];
      const address = newAddress();
      const { id } = await connected(userId, address);
      // Saving never leaves two active copies; this one is planted to check removal's own guard.
      const planted = await db.gmailMailbox.create({
        data: {
          userId: other,
          address,
          secretsEncrypted: sealSecrets(fake.issueTokensForTest(address)),
          disclosureVersion: GMAIL_DISCLOSURE_VERSION,
          historyCursor: "1",
        },
      });
      mailboxIds.push(planted.id);

      expect(
        await removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW }),
      ).toEqual({ endedAtGoogle: false, hadAccess: true });

      expect(await rowOf(id)).toBeNull();
      expect(fake.requests).toEqual([]);
    });

    it("leaves the permission at Google when another person connects the mailbox while its notices are being stopped", async () => {
      const [userId, newer] = [await person(), await person()];
      const address = newAddress();
      const { id } = await connected(userId, address);
      const stopping = fake.hold("stop");

      const removing = removeMailbox(userId, id, "user_disconnected", { client: db, now: NOW });
      await stopping.reached;
      // Their sign-in finishes while Google is stopping the notices. The row is gone by then, so
      // nothing is taken over.
      const theirs = await connected(newer, address);
      stopping.release();
      const removed = await removing;

      expect(theirs.tookOver).toBe(false);
      // Google still holds their permission, so the page can't say it ended.
      expect(removed).toEqual({ endedAtGoogle: false, hadAccess: true });
      expect(asked()).toEqual(["POST stop"]);
      expect(fake.revokedTokens).toEqual([]);
      expect((await rowOf(theirs.id))?.status).toBe("active");
      const access = {
        token: async () => theirs.tokens.accessToken,
        renew: async () => theirs.tokens.accessToken,
      };
      await expect(getProfile(access)).resolves.toMatchObject({ address });
      await expect(refreshTokens(theirs.tokens.refreshToken, { now: NOW })).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    // The client removal goes through, with its count of who holds the address failing at the given
    // turn (1: before the notices are stopped, 2: right before the permission is ended), as a
    // database dropping the connection would.
    function countFailsAt(failing: number) {
      const counts = { made: 0 };
      return db.$extends({
        query: {
          gmailMailbox: {
            async count({ args, query }) {
              counts.made += 1;
              if (counts.made === failing) throw new Error("Connection terminated unexpectedly");
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
    }

    it.each([
      { when: "before its notices are stopped", failing: 1, google: [] as string[] },
      { when: "right before the permission is ended", failing: 2, google: ["POST stop"] },
    ])(
      "doesn't end the permission when it can't tell whether anyone holds the mailbox ($when), and still records the Disconnect",
      async ({ failing, google }) => {
        const userId = await person();
        const { id } = await connected(userId, newAddress());
        const logged = errorsLogged();

        const removed = await removeMailbox(userId, id, "user_disconnected", {
          client: countFailsAt(failing),
          now: NOW,
        });

        // The page then says Google didn't confirm, and how to end it there.
        expect(removed).toEqual({ endedAtGoogle: false, hadAccess: true });
        expect(await rowOf(id)).toBeNull();
        expect(asked()).toEqual(google);
        expect(fake.revokedTokens).toEqual([]);
        const audit = await system().auditLog.findFirstOrThrow({
          where: { event: "gmail_disconnected", targetId: id },
        });
        expect(audit.metadata).toMatchObject({ user_id: userId, ended_at_google: false });
        // What kind of error it was, never what it said.
        expect(logged()).toContain("Gmail removal couldn't tell whether anyone holds the mailbox");
        expect(logged()).not.toContain("terminated");
      },
    );

    it("still says what it did, and still counts it, when the security record can't be written after the delete", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId, newAddress());
      vi.mocked(logAudit).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
      const logged = errorsLogged();

      const removed = await removeMailbox(userId, id, "user_disconnected", {
        client: db,
        now: NOW,
      });

      expect(removed).toEqual({ endedAtGoogle: true, hadAccess: true });
      expect(await rowOf(id)).toBeNull();
      expect(asked()).toEqual(["POST stop", "POST revoke"]);
      expect(fake.revokedTokens).toEqual([tokens.refreshToken]);
      expect(
        await system().auditLog.count({ where: { event: "gmail_disconnected", targetId: id } }),
      ).toBe(0);
      expect(
        await system().analyticsEvent.count({ where: { userId, name: "gmail_disconnected" } }),
      ).toBe(1);
      expect(logged()).toContain("Gmail removal not recorded");
      expect(logged()).not.toContain("terminated");
    });

    it("still says what it did, and still records it, when the count of Disconnects can't be written after the delete", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId, newAddress());
      vi.mocked(track).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
      const logged = errorsLogged();

      const removed = await removeMailbox(userId, id, "user_disconnected", {
        client: db,
        now: NOW,
      });

      expect(removed).toEqual({ endedAtGoogle: true, hadAccess: true });
      expect(await rowOf(id)).toBeNull();
      expect(fake.revokedTokens).toEqual([tokens.refreshToken]);
      const audit = await system().auditLog.findFirstOrThrow({
        where: { event: "gmail_disconnected", targetId: id },
      });
      expect(audit.metadata).toMatchObject({ ended_at_google: true });
      expect(
        await system().analyticsEvent.count({ where: { userId, name: "gmail_disconnected" } }),
      ).toBe(0);
      expect(logged()).toContain("Gmail removal not counted");
      expect(logged()).not.toContain("terminated");
    });

    // The client removal goes through, with a change landing between its read of the row and its
    // delete, as another request committing in that moment would.
    function overtakenBy(change: () => Promise<unknown>) {
      const landed = { yes: false };
      const client = db.$extends({
        query: {
          gmailMailbox: {
            async deleteMany({ args, query }) {
              if (!landed.yes) {
                landed.yes = true;
                await change();
              }
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
      return { client, landed };
    }

    it("sends nothing when another person takes the mailbox over between the read and the delete, and their copy still reads", async () => {
      const [userId, newer] = [await person(), await person()];
      const address = newAddress();
      const { id } = await connected(userId, address);
      const theirs: { accessToken?: string; tookOver?: boolean } = {};
      const { client, landed } = overtakenBy(async () => {
        const taken = await connected(newer, address);
        Object.assign(theirs, { accessToken: taken.tokens.accessToken, tookOver: taken.tookOver });
      });

      const removed = await removeMailbox(userId, id, "user_disconnected", { client, now: NOW });

      expect(landed.yes).toBe(true);
      expect(theirs.tookOver).toBe(true);
      expect(removed).toEqual({ endedAtGoogle: false, hadAccess: false });
      expect(await rowOf(id)).toBeNull();
      expect(fake.requests).toEqual([]);
      const access = {
        token: async () => theirs.accessToken ?? "",
        renew: async () => theirs.accessToken ?? "",
      };
      await expect(getProfile(access)).resolves.toMatchObject({ address });
    });

    it("sends nothing when the person connects it again between the read and the delete", async () => {
      const userId = await person();
      const address = newAddress();
      const { id } = await connected(userId, address);
      const { client, landed } = overtakenBy(() => connected(userId, address));

      const removed = await removeMailbox(userId, id, "user_disconnected", { client, now: NOW });

      expect(landed.yes).toBe(true);
      // Google still holds the newer permission, so the page can't say it ended.
      expect(removed).toEqual({ endedAtGoogle: false, hadAccess: true });
      expect(await rowOf(id)).toBeNull();
      expect(fake.requests).toEqual([]);
    });

    it("still ends the permission when a read renews the access token between the read and the delete", async () => {
      const userId = await person();
      // Run out, as an access token is when a read renews it.
      const { id, tokens } = await connected(userId, newAddress(), { expiresAt: at(-1) });
      const renewed = { accessToken: "" };
      // As a read saves a renewal: only over the value it opened, and Google keeps the refresh token.
      const { client, landed } = overtakenBy(async () => {
        const opened = await system().gmailMailbox.findUniqueOrThrow({ where: { id } });
        const fresh = await refreshTokens(tokens.refreshToken, { now: NOW });
        renewed.accessToken = fresh.accessToken;
        await system().gmailMailbox.updateMany({
          where: { id, secretsEncrypted: opened.secretsEncrypted },
          data: { secretsEncrypted: sealSecrets(fresh), accessExpiresAt: fresh.expiresAt },
        });
      });

      const removed = await removeMailbox(userId, id, "user_disconnected", { client, now: NOW });

      expect(landed.yes).toBe(true);
      expect(removed).toEqual({ endedAtGoogle: true, hadAccess: true });
      expect(await rowOf(id)).toBeNull();
      // The renewal, then the stop with its new access token, then the end of the permission.
      expect(asked()).toEqual(["POST token", "POST stop", "POST revoke"]);
      expect(fake.requests[1]?.bearer).toBe(renewed.accessToken);
      expect(fake.revokedTokens).toEqual([tokens.refreshToken]);
    });

    it("still ends the permission when key rotation seals the tokens again between the read and the delete", async () => {
      const userId = await person();
      const { id, tokens } = await connected(userId, newAddress());
      const rotation = { rotated: 0 };
      const { client, landed } = overtakenBy(async () => {
        vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k2:${Buffer.alloc(32, 3).toString("base64")}`);
        vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "k2");
        const done = await rotateKeys(
          { type: "admin", id: userId },
          { client: db, userIds: [userId] },
        );
        rotation.rotated = done.rotated;
      });
      try {
        const removed = await removeMailbox(userId, id, "user_disconnected", { client, now: NOW });

        expect(landed.yes).toBe(true);
        expect(rotation.rotated).toBe(1);
        expect(removed).toEqual({ endedAtGoogle: true, hadAccess: true });
        expect(await rowOf(id)).toBeNull();
        expect(asked()).toEqual(["POST stop", "POST revoke"]);
        expect(fake.revokedTokens).toEqual([tokens.refreshToken]);
      } finally {
        vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
        vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
      }
    });

    it("removes nothing for another person's mailbox id", async () => {
      const [owner, stranger] = [await person(), await person()];
      const { id } = await connected(owner, newAddress());
      const before = await rowOf(id);

      expect(
        await removeMailbox(stranger, id, "user_disconnected", { client: db, now: NOW }),
      ).toBeNull();

      expect(await rowOf(id)).toEqual(before);
      expect(fake.requests).toEqual([]);
      expect(
        await system().auditLog.count({ where: { event: "gmail_disconnected", targetId: id } }),
      ).toBe(0);
    });

    it("removes every mailbox of the person and no one else's", async () => {
      const [userId, other] = [await person(), await person()];
      const one = await connected(userId, newAddress());
      const two = await connected(userId, newAddress());
      const gone = await connected(userId, newAddress());
      await system().gmailMailbox.update({
        where: { id: gone.id },
        data: { status: "reconnect", secretsEncrypted: sealSecrets(NO_SECRETS) },
      });
      const theirs = await connected(other, newAddress());

      await removeAllMailboxes(userId, "inactive", { client: db, now: NOW, actor: SYSTEM_ACTOR });

      expect(await system().gmailMailbox.count({ where: { userId } })).toBe(0);
      expect(await rowOf(theirs.id)).not.toBeNull();
      expect([...fake.revokedTokens].sort()).toEqual(
        [one.tokens.refreshToken, two.tokens.refreshToken].sort(),
      );
      const audits = await system().auditLog.findMany({
        where: { event: "gmail_disconnected", targetId: { in: [one.id, two.id, gone.id] } },
      });
      expect(audits).toHaveLength(3);
      for (const audit of audits) {
        expect(audit).toMatchObject({ actorType: "system", actorId: null });
        expect(audit.metadata).toMatchObject({ user_id: userId, reason: "inactive" });
      }
    });
  });

  it("key rotation moves a mailbox's tokens to the new key, and they still open", async () => {
    const userId = await person();
    const { id } = await connected(userId, newAddress());
    const before = await system().gmailMailbox.findUniqueOrThrow({ where: { id } });
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k2:${Buffer.alloc(32, 3).toString("base64")}`);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "k2");
    try {
      // As the admin page's button runs it; a person of this file, so the record is cleaned up.
      await rotateKeys({ type: "admin", id: userId }, { client: db, userIds: [userId] });
      const after = await system().gmailMailbox.findUniqueOrThrow({ where: { id } });
      expect(keyIdOf(after.secretsEncrypted)).toBe("k2");
      expect(openSecrets(after.secretsEncrypted)).toEqual(openSecrets(before.secretsEncrypted));
    } finally {
      vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
      vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
    }
  });
});
