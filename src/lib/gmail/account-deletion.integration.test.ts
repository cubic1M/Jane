import type { PlaidApi } from "plaid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Deleting an account that has Gmail mailboxes (src/lib/account-deletion.ts), against a real
// database and the fake Google: every mailbox and what was read through it goes, and Google is
// asked to end each permission. A sealed value that won't open, or a Google that refuses or can't
// be reached, doesn't stop the deletion. A bank Plaid can't remove stops it before any mailbox
// goes, so nothing is deleted and the person can try again. A mailbox connected while it runs
// stops it before the account goes, as a bank linked meanwhile does, and trying again ends that
// one too. Nothing here talks to Google or Plaid.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { plaidApiError } from "@/data-sources/plaid/__fixtures__/plaid";
import { deleteAllData } from "@/lib/account-deletion";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { PlaidRequestError } from "@/lib/plaid/client";
import { systemDb } from "@/lib/system-db";
import { FakeGoogle } from "./__fixtures__/fake-google";
import { saveMailbox } from "./mailbox";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: makes people with mailboxes, checks what deleting left");
const KEY = Buffer.alloc(32, 6).toString("base64");
const NOW = new Date("2026-11-19T12:00:00.000Z");
// Account deletion reads the clock itself. An access token good until then is good whenever this
// runs, so each mailbox's notices are stopped before its permission ends.
const GOOD_UNTIL = new Date("2100-01-01T00:00:00.000Z");
// Plaid for the people here without a bank: never asked.
const api = { itemRemove: vi.fn() } as unknown as PlaidApi;
const GONE_MEANWHILE = "A mailbox was connected while this account was being deleted";

describe.runIf(url)("deleting an account with mailboxes", () => {
  let fake: FakeGoogle;
  const people: string[] = [];
  const mailboxIds: string[] = [];
  const said: string[] = [];

  const newAddress = () => `mailbox.${crypto.randomUUID()}@fake-mailbox.test`;

  async function person(email = `gmail-delete-${crypto.randomUUID()}@example.com`) {
    const user = await db.user.create({ data: { email } });
    people.push(user.id);
    return user.id;
  }

  // A mailbox saved as the callback saves one, with one money email read from it.
  async function withMailbox(userId: string, address = newAddress()) {
    const tokens = { ...fake.issueTokensForTest(address), expiresAt: GOOD_UNTIL };
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

  const accountsOf = (userId: string) => system().user.count({ where: { id: userId } });
  const rowOf = (id: string) => system().gmailMailbox.findUnique({ where: { id } });
  const readingsOf = (mailboxId: string) => system().gmailReading.count({ where: { mailboxId } });
  // What the fake Google was asked, in order: the method and the last part of the path.
  const asked = () => fake.requests.map((r) => `${r.method} ${r.path.split("/").at(-1)}`);
  const removalsOf = (ids: string[]) =>
    system().auditLog.findMany({ where: { event: "gmail_disconnected", targetId: { in: ids } } });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
    // The fake Google is used only outside production.
    vi.stubEnv("VERCEL_ENV", "");
    // Off: deleting never depends on the switch.
    vi.stubEnv("GMAIL_LINK", "");
  });
  afterAll(async () => {
    // The access log's records outlive the account, as /privacy says: these are this file's own.
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

  it("removes every mailbox and what was read through it, and asks Google to end each permission, leaving another person's alone", async () => {
    const userId = await person();
    const one = await withMailbox(userId);
    const two = await withMailbox(userId);
    const theirs = await withMailbox(await person());

    await deleteAllData(userId, { client: db, api });

    expect(await accountsOf(userId)).toBe(0);
    for (const { id } of [one, two]) {
      expect(await rowOf(id)).toBeNull();
      expect(await readingsOf(id)).toBe(0);
    }
    expect(await rowOf(theirs.id)).not.toBeNull();
    expect(await readingsOf(theirs.id)).toBe(1);
    // Each one's notices stopped, then its permission ended.
    expect(asked()).toEqual(["POST stop", "POST revoke", "POST stop", "POST revoke"]);
    expect([...fake.stopped].sort()).toEqual([one.address, two.address].sort());
    expect([...fake.revokedTokens].sort()).toEqual(
      [one.tokens.refreshToken, two.tokens.refreshToken].sort(),
    );
    // A security record of each stays, as the access log's do: the reason, never the address.
    const audits = await removalsOf([one.id, two.id]);
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        actorType: "user",
        actorId: userId,
        targetType: "gmail_mailbox",
      });
      expect(audit.metadata).toMatchObject({
        user_id: userId,
        reason: "user_deleted_data",
        ended_at_google: true,
      });
    }
    const kept = JSON.stringify(audits);
    for (const { address, tokens } of [one, two]) {
      expect(kept).not.toContain(address);
      expect(kept).not.toContain(tokens.accessToken);
      expect(kept).not.toContain(tokens.refreshToken);
    }
    expect(said).toEqual([]);
  });

  it("still deletes the account when a mailbox's sealed value won't open, sending nothing for that one", async () => {
    const userId = await person();
    const good = await withMailbox(userId);
    const broken = await withMailbox(userId);
    await system().gmailMailbox.update({
      where: { id: broken.id },
      data: { secretsEncrypted: "planted-marker-text" },
    });

    await deleteAllData(userId, { client: db, api });

    expect(await accountsOf(userId)).toBe(0);
    for (const { id } of [good, broken]) {
      expect(await rowOf(id)).toBeNull();
      expect(await readingsOf(id)).toBe(0);
    }
    expect(asked()).toEqual(["POST stop", "POST revoke"]);
    expect(fake.stopped).toEqual([good.address]);
    expect(fake.revokedTokens).toEqual([good.tokens.refreshToken]);
    const [audit] = await removalsOf([broken.id]);
    expect(audit?.metadata).toMatchObject({ reason: "user_deleted_data", ended_at_google: false });
    expect(said).toEqual([]);
  });

  it("still deletes the account when Google refuses to end the permission", async () => {
    const userId = await person();
    const mailbox = await withMailbox(userId);
    fake.answerWith("revoke", 503);

    await deleteAllData(userId, { client: db, api });

    expect(await accountsOf(userId)).toBe(0);
    expect(await rowOf(mailbox.id)).toBeNull();
    expect(await readingsOf(mailbox.id)).toBe(0);
    // Asked once, and not again.
    expect(asked()).toEqual(["POST stop", "POST revoke"]);
    expect(fake.requests.at(-1)?.form.token).toBe(mailbox.tokens.refreshToken);
    const [audit] = await removalsOf([mailbox.id]);
    expect(audit?.metadata).toMatchObject({ ended_at_google: false });
    // Not even Google's answer, which repeats the token it was sent.
    expect(said).toEqual([]);
  });

  it("still deletes the account when Google can't be reached at all", async () => {
    const userId = await person();
    const mailbox = await withMailbox(userId);
    await fake.stop();

    await deleteAllData(userId, { client: db, api });

    expect(await accountsOf(userId)).toBe(0);
    expect(await rowOf(mailbox.id)).toBeNull();
    expect(await readingsOf(mailbox.id)).toBe(0);
    const [audit] = await removalsOf([mailbox.id]);
    expect(audit?.metadata).toMatchObject({ ended_at_google: false });
    expect(said).toEqual([]);
  });

  // Settings: "We couldn't disconnect your banks. Nothing was deleted; try again."
  it("deletes nothing, and asks Google nothing, when Plaid can't remove a bank", async () => {
    const userId = await person();
    await db.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt(`access-${crypto.randomUUID()}`),
      },
    });
    const mailbox = await withMailbox(userId);
    const failing = {
      itemRemove: vi.fn().mockRejectedValue(plaidApiError("INTERNAL_SERVER_ERROR", 500)),
    } as unknown as PlaidApi;

    await expect(deleteAllData(userId, { client: db, api: failing })).rejects.toBeInstanceOf(
      PlaidRequestError,
    );

    expect(await accountsOf(userId)).toBe(1);
    expect(await rowOf(mailbox.id)).not.toBeNull();
    expect(await readingsOf(mailbox.id)).toBe(1);
    expect(fake.requests).toEqual([]);
  });

  it("stops before the account goes when a mailbox is connected meanwhile, and trying again ends that one too", async () => {
    const userId = await person();
    const first = await withMailbox(userId);
    const held = fake.hold("revoke");
    const deleting = deleteAllData(userId, { client: db, api });
    // Caught at once, so its failure is never left unhandled while the test works below.
    const refused = expect(deleting).rejects.toThrow(GONE_MEANWHILE);
    await held.reached;
    // Connected from another tab while the first mailbox's permission is being ended.
    const late = await withMailbox(userId);
    held.release();
    await refused;

    expect(await accountsOf(userId)).toBe(1);
    expect(await rowOf(first.id)).toBeNull();
    expect(await rowOf(late.id)).not.toBeNull();
    expect(fake.revokedTokens).toEqual([first.tokens.refreshToken]);

    await deleteAllData(userId, { client: db, api });

    expect(await accountsOf(userId)).toBe(0);
    expect(await rowOf(late.id)).toBeNull();
    expect(await readingsOf(late.id)).toBe(0);
    expect(fake.revokedTokens).toEqual([first.tokens.refreshToken, late.tokens.refreshToken]);
  });

  // /privacy: "You can delete everything". The mailbox is often the address they signed up with.
  it("leaves the mailbox's address nowhere in the database, even when it is the account's own email", async () => {
    const address = newAddress();
    const userId = await person(address);
    await withMailbox(userId, address);

    await deleteAllData(userId, { client: db, api });

    const columns = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json')`;
    const left: string[] = [];
    for (const { table_name, column_name } of columns) {
      const rows = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE $1`,
        `%${address}%`,
      );
      if ((rows[0]?.n ?? 0) > 0) left.push(`${table_name}.${column_name}`);
    }
    expect(left).toEqual([]);
    expect(fake.revokedTokens).toHaveLength(1);
  });
});
