import type { PlaidApi } from "plaid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The inactivity clean-up (src/lib/plaid/inactive.ts) with Gmail mailboxes, against a real database
// and the fake Google: who is warned and in which words, and that a person gone quiet loses every
// mailbox and what was read from it, even while a bank beside it can't be removed, with Google
// asked to end each permission. People without a mailbox get the email they always had, word for
// word. Nothing here talks to Google, Plaid or Resend.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { REMOVAL_WARNING_DAYS } from "@/config/retention";
import { TRIAL_EMAIL_DOMAIN, TRIAL_ID_PREFIX } from "@/config/trial";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { sendEmail } from "@/lib/email";
import { removalWords, runInactiveCleanup } from "@/lib/plaid/inactive";
import { removePlaidItem } from "@/lib/plaid/remove";
import { systemDb } from "@/lib/system-db";
import { FakeGoogle } from "./__fixtures__/fake-google";
import { removeAllMailboxes, saveMailbox } from "./mailbox";
import { NO_SECRETS, sealSecrets } from "./secrets";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: makes people gone quiet, checks their rows, and cleans up");
const KEY = Buffer.alloc(32, 5).toString("base64");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-11-19T12:00:00.000Z");
// The removal the warning given at NOW names, and the run that does it.
const WEEK_LATER = new Date(NOW.getTime() + REMOVAL_WARNING_DAYS * DAY);
const LINK = "https://jane.example/report";

// The warning as src/lib/plaid/inactive.ts sent it before mailboxes, copied from that file, with
// the day and the link filled in.
const emailBeforeMailboxes = (to: string, what: string) => {
  const date = removalWords(WEEK_LATER);
  return {
    to,
    subject: "We'll disconnect your banks soon | Jane",
    text: `You haven't used Jane in a while, so on ${date} we'll disconnect ${what}. That removes their accounts and transactions and what was worked out from them, and while Jane is in beta you may not be able to link them again.\n\nWant to keep them connected? Just open your report: ${LINK}`,
    html: `<p>You haven't used Jane in a while, so on ${date} we'll disconnect ${what}. That removes their accounts and transactions and what was worked out from them, and while Jane is in beta you may not be able to link them again.</p><p>Want to keep them connected? <a href="${LINK}">Open your report</a>.</p>`,
  };
};

describe.runIf(url)("the inactivity clean-up with mailboxes", () => {
  let fake: FakeGoogle;
  const people: string[] = [];
  const mailboxIds: string[] = [];
  const itemIds: string[] = [];
  const said: string[] = [];

  // Someone who signed up long ago and hasn't opened Jane since: the clean-up warns them at NOW.
  async function quietPerson({ id, email }: { id?: string; email?: string } = {}) {
    const user = await db.user.create({
      data: {
        ...(id ? { id } : {}),
        email: email ?? `gmail-quiet-${crypto.randomUUID()}@example.com`,
        createdAt: new Date(NOW.getTime() - 200 * DAY),
      },
    });
    people.push(user.id);
    return { userId: user.id, email: user.email };
  }

  // A mailbox saved as the callback saves one, with one money email read from it.
  async function withMailbox(userId: string) {
    const address = `mailbox.${crypto.randomUUID()}@fake-mailbox.test`;
    const tokens = {
      ...fake.issueTokensForTest(address),
      expiresAt: new Date(NOW.getTime() + HOUR),
    };
    const saved = await saveMailbox(
      userId,
      {
        address,
        historyId: fake.mailbox(address).historyId,
        tokens,
        disclosureVersion: GMAIL_DISCLOSURE_VERSION,
      },
      { client: db, now: NOW },
    );
    if ("refused" in saved) throw new Error("The mailbox was refused");
    mailboxIds.push(saved.id);
    await db.gmailReading.create({
      data: {
        userId,
        mailboxId: saved.id,
        messageRef: `m${crypto.randomUUID().replaceAll("-", "")}`,
        receivedAt: NOW,
        senderDomain: "northwind-power.example",
        kind: "bill",
        amountCents: 4210,
      },
    });
    return { id: saved.id, address, tokens };
  }

  async function withBank(userId: string) {
    const item = await db.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt(`access-${crypto.randomUUID()}`),
      },
    });
    itemIds.push(item.id);
    return item;
  }

  // Never opened by a warning.
  const withRobinhood = (userId: string) =>
    db.robinhoodConnection.create({
      data: { userId, secretsEncrypted: "never opened here", clientId: "fake-client" },
    });

  const rowOf = (id: string) => system().gmailMailbox.findUnique({ where: { id } });
  const readingsOf = (mailboxId: string) => system().gmailReading.count({ where: { mailboxId } });
  const revokesAsked = () =>
    fake.requests.filter((r) => r.path.endsWith("/revoke")).map((r) => r.form.token);
  const removalsOf = (mailboxId: string) =>
    system().auditLog.findMany({ where: { event: "gmail_disconnected", targetId: mailboxId } });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
    // The fake Google is used only outside production.
    vi.stubEnv("VERCEL_ENV", "");
    // Off: removing a mailbox never depends on the switch.
    vi.stubEnv("GMAIL_LINK", "");
    vi.stubEnv("APP_URL", "https://jane.example");
    // The warning goes to `send`, not to the console.
    vi.stubEnv("RESEND_API_KEY", "test");
    vi.stubEnv("EMAIL_FROM", "Jane <hello@jane.example>");
  });
  afterAll(async () => {
    await system().auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: people } },
          { targetId: { in: [...mailboxIds, ...itemIds] } },
          ...people.map((id) => ({ metadata: { path: ["user_id"], equals: id } })),
        ],
      },
    });
    await system().user.deleteMany({ where: { id: { in: people } } });
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    fake = await new FakeGoogle().start();
    vi.stubEnv("GMAIL_API_URL", fake.origin);
    said.length = 0;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });
  afterEach(async () => {
    await fake.stop();
  });

  it("warns a person with only a mailbox in a mailbox's words, then removes it a week later and asks Google to end the permission", async () => {
    const { userId, email } = await quietPerson();
    const mailbox = await withMailbox(userId);
    const send = vi.fn<typeof sendEmail>(async () => undefined);

    const warned = await runInactiveCleanup({ client: db, now: NOW, send, userIds: [userId] });

    expect(warned).toEqual({ warned: 1, removed: 0, failed: 0 });
    const date = removalWords(WEEK_LATER);
    expect(send.mock.calls).toEqual([
      [
        {
          to: email,
          subject: "We'll disconnect your mailboxes soon | Jane",
          text: `You haven't used Jane in a while, so on ${date} we'll disconnect your Gmail mailboxes. That deletes what Jane read from them and ends Jane's permission at Google. You can connect them again later.\n\nWant to keep them connected? Just open your report: ${LINK}`,
          html: `<p>You haven't used Jane in a while, so on ${date} we'll disconnect your Gmail mailboxes. That deletes what Jane read from them and ends Jane's permission at Google. You can connect them again later.</p><p>Want to keep them connected? <a href="${LINK}">Open your report</a>.</p>`,
        },
      ],
    ]);
    // Only warned: still connected, and nothing asked of Google.
    expect(await rowOf(mailbox.id)).not.toBeNull();
    expect(fake.requests).toEqual([]);

    const removed = await runInactiveCleanup({
      client: db,
      now: WEEK_LATER,
      send,
      userIds: [userId],
    });

    expect(removed).toEqual({ warned: 0, removed: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await rowOf(mailbox.id)).toBeNull();
    expect(await readingsOf(mailbox.id)).toBe(0);
    // Its access token ran out before the week did: nothing to stop with, only the permission to end.
    expect(fake.requests.map((r) => `${r.method} ${r.path.split("/").at(-1)}`)).toEqual([
      "POST revoke",
    ]);
    expect(fake.revokedTokens).toEqual([mailbox.tokens.refreshToken]);
    const [audit, ...more] = await removalsOf(mailbox.id);
    expect(more).toEqual([]);
    expect(audit).toMatchObject({ actorType: "system", actorId: null });
    expect(audit.metadata).toMatchObject({
      user_id: userId,
      reason: "inactive",
      ended_at_google: true,
    });
    expect(JSON.stringify(audit)).not.toContain(mailbox.address);
    // The warning is spent, and nothing was logged on the way.
    const user = await system().user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.plaidRemovalWarnedAt).toBeNull();
    expect(said).toEqual([]);
  });

  it("warns a person with a bank and a mailbox of each with its own consequence, then they lose both", async () => {
    const { userId, email } = await quietPerson();
    const item = await withBank(userId);
    const mailbox = await withMailbox(userId);
    const send = vi.fn<typeof sendEmail>(async () => undefined);
    // Plaid's side of a bank's removal, played here; everything after it is the real removal.
    const itemRemove = vi.fn(async () => ({ data: { request_id: "fake-request" } }));
    const remove: typeof removePlaidItem = (id, itemId, reason, options) =>
      removePlaidItem(id, itemId, reason, {
        ...options,
        api: { itemRemove } as unknown as PlaidApi,
      });

    await runInactiveCleanup({ client: db, now: NOW, send, remove, userIds: [userId] });

    const date = removalWords(WEEK_LATER);
    expect(send.mock.calls[0]?.[0]).toEqual({
      to: email,
      subject: "We'll disconnect your banks and mailboxes soon | Jane",
      text: `You haven't used Jane in a while, so on ${date} we'll disconnect your linked banks and your Gmail mailboxes. Disconnecting your banks removes their accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link them again. Disconnecting your mailboxes deletes what Jane read from them and ends Jane's permission at Google. You can connect the mailboxes again later.\n\nWant to keep them connected? Just open your report: ${LINK}`,
      html: `<p>You haven't used Jane in a while, so on ${date} we'll disconnect your linked banks and your Gmail mailboxes. Disconnecting your banks removes their accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link them again. Disconnecting your mailboxes deletes what Jane read from them and ends Jane's permission at Google. You can connect the mailboxes again later.</p><p>Want to keep them connected? <a href="${LINK}">Open your report</a>.</p>`,
    });
    expect(itemRemove).not.toHaveBeenCalled();
    expect(fake.requests).toEqual([]);

    const removed = await runInactiveCleanup({
      client: db,
      now: WEEK_LATER,
      send,
      remove,
      userIds: [userId],
    });

    expect(removed).toEqual({ warned: 0, removed: 1, failed: 0 });
    expect(itemRemove).toHaveBeenCalledTimes(1);
    expect(await system().plaidItem.count({ where: { id: item.id } })).toBe(0);
    expect(await rowOf(mailbox.id)).toBeNull();
    expect(await readingsOf(mailbox.id)).toBe(0);
    expect(fake.revokedTokens).toEqual([mailbox.tokens.refreshToken]);
  });

  it("removes the mailbox even when the bank beside it can't be removed, and keeps the warning for the bank", async () => {
    const { userId } = await quietPerson();
    const item = await withBank(userId);
    const mailbox = await withMailbox(userId);
    const send = vi.fn<typeof sendEmail>(async () => undefined);
    await runInactiveCleanup({ client: db, now: NOW, send, userIds: [userId] });
    // Plaid turning the bank's removal down, as it would every night.
    const remove = vi.fn<typeof removePlaidItem>(async () => {
      throw new Error("A stand-in failure");
    });

    const run = await runInactiveCleanup({
      client: db,
      now: WEEK_LATER,
      send,
      remove,
      userIds: [userId],
    });

    expect(run).toEqual({ warned: 0, removed: 0, failed: 1 });
    expect(await rowOf(mailbox.id)).toBeNull();
    expect(await readingsOf(mailbox.id)).toBe(0);
    expect(fake.revokedTokens).toEqual([mailbox.tokens.refreshToken]);
    // The bank was tried and stays, and so does the warning: the next run tries the bank again.
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await system().plaidItem.count({ where: { id: item.id } })).toBe(1);
    const kept = await system().user.findUniqueOrThrow({ where: { id: userId } });
    expect(kept.plaidRemovalWarnedAt).toEqual(NOW);
  });

  it("sends people without a mailbox the email they always had, byte for byte", async () => {
    const banks = await quietPerson();
    await withBank(banks.userId);
    const robinhood = await quietPerson();
    await withRobinhood(robinhood.userId);
    const both = await quietPerson();
    await withBank(both.userId);
    await withRobinhood(both.userId);
    const send = vi.fn<typeof sendEmail>(async () => undefined);

    const run = await runInactiveCleanup({
      client: db,
      now: NOW,
      send,
      userIds: [banks.userId, robinhood.userId, both.userId],
    });

    expect(run).toEqual({ warned: 3, removed: 0, failed: 0 });
    const sent = new Map(send.mock.calls.map(([email]) => [email.to, email] as const));
    expect(sent.get(banks.email)).toEqual(emailBeforeMailboxes(banks.email, "your linked banks"));
    expect(sent.get(robinhood.email)).toEqual(
      emailBeforeMailboxes(robinhood.email, "your Robinhood connection"),
    );
    expect(sent.get(both.email)).toEqual(
      emailBeforeMailboxes(both.email, "your linked banks and Robinhood"),
    );
  });

  it("still removes a mailbox when Google refuses to end the permission, or its sealed value won't open", async () => {
    const refused = await quietPerson();
    const refusedMailbox = await withMailbox(refused.userId);
    const unreadable = await quietPerson();
    const unreadableMailbox = await withMailbox(unreadable.userId);
    await system().gmailMailbox.update({
      where: { id: unreadableMailbox.id },
      data: { secretsEncrypted: "planted-marker-text" },
    });
    const userIds = [refused.userId, unreadable.userId];
    const send = vi.fn<typeof sendEmail>(async () => undefined);
    await runInactiveCleanup({ client: db, now: NOW, send, userIds });
    fake.answerWith("revoke", 503);

    const run = await runInactiveCleanup({ client: db, now: WEEK_LATER, send, userIds });

    expect(run).toEqual({ warned: 0, removed: 2, failed: 0 });
    for (const { id } of [refusedMailbox, unreadableMailbox]) {
      expect(await rowOf(id)).toBeNull();
      expect(await readingsOf(id)).toBe(0);
    }
    // Asked once, for the one it had a permission for, and not again.
    expect(revokesAsked()).toEqual([refusedMailbox.tokens.refreshToken]);
    for (const { id } of [refusedMailbox, unreadableMailbox]) {
      const audits = await removalsOf(id);
      expect(audits.map((audit) => audit.metadata)).toEqual([
        expect.objectContaining({ reason: "inactive", ended_at_google: false }),
      ]);
    }
  });

  it("a removal failing for one person doesn't stop the next person's", async () => {
    const [one, two] = [await quietPerson(), await quietPerson()];
    const mailboxes = new Map([
      [one.userId, await withMailbox(one.userId)],
      [two.userId, await withMailbox(two.userId)],
    ]);
    const userIds = [one.userId, two.userId];
    const send = vi.fn<typeof sendEmail>(async () => undefined);
    await runInactiveCleanup({ client: db, now: NOW, send, userIds });
    // The first person the run reaches fails, whichever that is; the next goes through for real.
    // Its error quotes the mailbox's address and token, as a database error quoting the row might.
    const reached: string[] = [];
    const removeMailboxes: typeof removeAllMailboxes = async (userId, reason, options) => {
      reached.push(userId);
      const mine = mailboxes.get(userId);
      if (reached.length === 1) {
        throw new Error(
          `A stand-in failure for ${mine?.address} with ${mine?.tokens.refreshToken}`,
        );
      }
      return removeAllMailboxes(userId, reason, options);
    };

    const run = await runInactiveCleanup({
      client: db,
      now: WEEK_LATER,
      send,
      removeMailboxes,
      userIds,
    });

    expect(run).toEqual({ warned: 0, removed: 1, failed: 1 });
    expect([...reached].sort()).toEqual([...userIds].sort());
    const [failed, next] = reached;
    expect(await rowOf(mailboxes.get(failed)?.id ?? "")).not.toBeNull();
    expect(await rowOf(mailboxes.get(next)?.id ?? "")).toBeNull();
    // The one that failed keeps its warning, so the next run tries it again.
    const kept = await system().user.findUniqueOrThrow({ where: { id: failed } });
    expect(kept.plaidRemovalWarnedAt).toEqual(NOW);
    // The clean-up's one log line for a failure: the person's id and the error, with the address
    // and token it quoted taken out.
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("Inactive cleanup failed");
    for (const { address, tokens } of mailboxes.values()) {
      expect(said[0]).not.toContain(address);
      expect(said[0]).not.toContain(tokens.refreshToken);
    }
  });

  it("never emails a trial person, even one holding a mailbox", async () => {
    const id = `${TRIAL_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
    const { userId } = await quietPerson({ id, email: `${id}@${TRIAL_EMAIL_DOMAIN}` });
    // A trial person can't connect one (whyCantConnect); planted, as the access proof plants rows.
    const planted = await db.gmailMailbox.create({
      data: {
        userId,
        address: `mailbox.${crypto.randomUUID()}@fake-mailbox.test`,
        secretsEncrypted: sealSecrets(NO_SECRETS),
        disclosureVersion: GMAIL_DISCLOSURE_VERSION,
        historyCursor: "1",
      },
    });
    mailboxIds.push(planted.id);
    // Resend is never reached; a request to it would fail here rather than leave the machine.
    const outside = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network here"));

    // With the real sender.
    const run = await runInactiveCleanup({ client: db, now: NOW, userIds: [userId] });

    // Reached and counted, as anyone is; the sender drops a trial person's address.
    expect(run).toEqual({ warned: 1, removed: 0, failed: 0 });
    expect(outside).not.toHaveBeenCalled();
  });
});
