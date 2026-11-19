import { createHash } from "node:crypto";
import { GMAIL_KINDS, GMAIL_LIMITS, type GmailKind } from "@/config/gmail";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit, type AuditActor } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { onlyDemoBank } from "@/lib/only-demo-bank";
import { systemDb, systemTransaction } from "@/lib/system-db";
import { isTrialUser } from "@/lib/trial-ids";
import { stopWatch } from "./api";
import { revokeTokens, type Tokens } from "./oauth";
import { NO_SECRETS, openSecrets, sealSecrets, type GmailSecrets } from "./secrets";

// A person's Gmail mailboxes (docs/setup/gmail.md): who may connect one, saving a sign-in, what the
// mailboxes page shows, and removing one with everything read through it. A mailbox belongs to one
// person at a time: connecting an address someone else holds moves it to the newest sign-in, and
// the earlier copy stops. Tokens are opened here only to end them at Google when a mailbox is
// removed. No address, token or word of Google's goes into a log, an audit record or an analytics
// event.

// active; reconnect: Google stopped accepting its tokens, which were wiped; elsewhere: it was
// connected to another Jane account since, and its tokens were wiped.
const STATUS = { active: "active", reconnect: "reconnect", elsewhere: "elsewhere" } as const;
type MailboxStatus = (typeof STATUS)[keyof typeof STATUS];
const STATUSES: readonly MailboxStatus[] = Object.values(STATUS);

type Options = { client?: PrismaClient };

// Trial people are sample data and never reach a company, and sample accounts beside a real
// mailbox would blur which numbers are real. Someone with nothing linked yet is welcome.
export async function whyCantConnect(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<"trial" | "demo" | null> {
  if (isTrialUser(userId)) return "trial";
  if (await onlyDemoBank(userId, client)) return "demo";
  return null;
}

const WHY_SAVE =
  "Connecting a mailbox: the same address may be held by another person, whose copy has to stop";

// The number saves of one address queue on (pg_advisory_xact_lock takes a bigint): the first eight
// bytes of a hash of the address. Another address that happens to share it only waits its turn too.
const turnOf = (address: string): bigint =>
  createHash("sha256").update(`gmail_mailbox ${address}`).digest().readBigInt64BE(0);

type Saved = { id: string; reconnected: boolean; tookOver: boolean } | { refused: "too_many" };

// Saves a sign-in, encrypted, for the address Google named. An address the person has already is
// connected again, always allowed; a new one is refused at the cap, with nothing written. Anyone
// else's active copy of the address stops and loses its tokens (their readings stay). All in one
// transaction whose first statement waits for any other save of the same address, so two people
// connecting one mailbox at once take turns, and the second takes it from the first.
export async function saveMailbox(
  userId: string,
  {
    address,
    historyId,
    tokens,
    disclosureVersion,
  }: { address: string; historyId: string; tokens: Tokens; disclosureVersion: string },
  { client = defaultClient, now = new Date() }: Options & { now?: Date } = {},
): Promise<Saved> {
  // Capitals mustn't make a second holder of the same mailbox.
  const mailbox = address.toLowerCase();
  const saved = await systemTransaction(
    WHY_SAVE,
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${turnOf(mailbox)})`;
      const mine = await tx.gmailMailbox.findUnique({
        where: { userId_address: { userId, address: mailbox } },
        select: { id: true },
      });
      if (!mine) {
        const theirs = await tx.gmailMailbox.count({ where: { userId } });
        // At the cap: refused, with nothing written.
        if (theirs >= GMAIL_LIMITS.mailboxesMost) return null;
      }
      const others = await tx.gmailMailbox.findMany({
        where: { address: mailbox, status: STATUS.active, userId: { not: userId } },
        select: { id: true, userId: true },
      });
      const movedFrom: typeof others = [];
      for (const other of others) {
        // A copy that stopped or was removed meanwhile is left as it is, with no audit record.
        const { count } = await tx.gmailMailbox.updateMany({
          where: { id: other.id, status: STATUS.active },
          data: {
            status: STATUS.elsewhere,
            secretsEncrypted: sealSecrets(NO_SECRETS),
            accessExpiresAt: null,
            watchExpiresAt: null,
          },
        });
        if (count > 0) movedFrom.push(other);
      }
      // What a sign-in sets, on a new row or one connected again. Not the place reading has
      // reached, which a reconnect keeps, nor syncingSince, which belongs to a read that may be
      // running. The old sealed value is replaced without being opened.
      const signedIn = {
        status: STATUS.active,
        secretsEncrypted: sealSecrets(tokens),
        accessExpiresAt: tokens.expiresAt,
        disclosureVersion,
        agreedAt: now,
        failures: 0,
        nextTryAt: null,
        lastErrorCode: null,
        watchExpiresAt: null,
      };
      const row = await tx.gmailMailbox.upsert({
        where: { userId_address: { userId, address: mailbox } },
        // Reading starts from where the mailbox is now.
        create: { userId, address: mailbox, historyCursor: historyId, createdAt: now, ...signedIn },
        update: signedIn,
        select: { id: true },
      });
      return { id: row.id, reconnected: mine !== null, movedFrom };
    },
    client,
  );
  if (!saved) return { refused: "too_many" };
  for (const earlier of saved.movedFrom) {
    await logAudit(
      { type: "user", id: userId },
      "gmail_taken_over",
      { type: "gmail_mailbox", id: earlier.id },
      { user_id: earlier.userId },
    );
  }
  return { id: saved.id, reconnected: saved.reconnected, tookOver: saved.movedFrom.length > 0 };
}

const WHY_HELD =
  "Whether anyone still holds a mailbox: ending it at Google would end that person's copy too";

// Whether any person's active mailbox holds this address. At Google, ending one permission ends
// every permission the project holds for that account, so Jane asks only when this is false.
export async function heldByAnyone(
  address: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const holders = await systemDb(WHY_HELD, client).gmailMailbox.count({
    where: { address: address.toLowerCase(), status: STATUS.active },
  });
  return holders > 0;
}

// A mailbox as the page shows it: never its tokens or the place reading has reached.
export type MailboxView = {
  id: string;
  address: string;
  // null: not one of the three words (only a row a test planted holds another).
  status: MailboxStatus | null;
  createdAt: Date;
  // When they last connected it. Connecting again keeps createdAt, so the page times a first read
  // from this.
  agreedAt: Date;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  missedAt: Date | null;
  watchExpiresAt: Date | null;
};

// The person's mailboxes, in the order they connected them.
export async function mailboxesView(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<MailboxView[]> {
  const rows = await scopedFor(userId, client).gmailMailboxes.findMany({
    select: {
      id: true,
      address: true,
      status: true,
      createdAt: true,
      agreedAt: true,
      lastCheckedAt: true,
      lastErrorCode: true,
      missedAt: true,
      watchExpiresAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    ...row,
    status: STATUSES.find((known) => known === row.status) ?? null,
  }));
}

// A money email as the page lists it: what it said, never its text or Gmail's id for it.
export type ReadingView = {
  id: string;
  // The address of the connected mailbox it was read in.
  mailbox: string;
  senderDomain: string;
  // null: not one of GMAIL_KINDS, which the page shows as "Other".
  kind: GmailKind | null;
  amountCents: number | null;
  occursOn: Date | null;
  receivedAt: Date;
};

// The newest money emails, at most the page's number, and whether there are more.
export async function readingsView(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ readings: ReadingView[]; more: boolean }> {
  const rows = await scopedFor(userId, client).gmailReadings.findMany({
    select: {
      id: true,
      senderDomain: true,
      kind: true,
      amountCents: true,
      occursOn: true,
      receivedAt: true,
      mailbox: { select: { address: true } },
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    // One more than is shown, to know whether there are more.
    take: GMAIL_LIMITS.shownReadings + 1,
  });
  return {
    readings: rows.slice(0, GMAIL_LIMITS.shownReadings).map(({ mailbox, kind, ...row }) => ({
      ...row,
      mailbox: mailbox.address,
      kind: GMAIL_KINDS.find((known) => known === kind) ?? null,
    })),
    more: rows.length > GMAIL_LIMITS.shownReadings,
  };
}

type RemovalReason = "user_disconnected" | "user_deleted_data" | "inactive";
type RemoveOptions = Options & { now?: Date; actor?: AuditActor };

// What removing a mailbox did, for the words the page shows after it.
type Removed = {
  // Google said it ended Jane's permission.
  endedAtGoogle: boolean;
  // The mailbox was still connected, so when Google didn't confirm, it may still list Jane. False
  // when Jane had lost its access already: Google stopped accepting it, or it was connected to
  // another Jane account.
  hadAccess: boolean;
};

// The tokens in a sealed value. One that won't open holds nothing that could be sent, and the row
// is still deleted.
function tokensIn(sealed: string): GmailSecrets {
  try {
    return openSecrets(sealed);
  } catch {
    return NO_SECRETS;
  }
}

// Deletes the mailbox and what was read through it (ON DELETE CASCADE), and only then asks Google
// to end the permission: a slow Google, or a sealed value that won't open, can't leave the row
// here. Google is asked only when no active row holds the address any more. Null when the person
// has no such mailbox. Works with the switch off and while reading is paused.
export async function removeMailbox(
  userId: string,
  mailboxId: string,
  reason: RemovalReason,
  {
    client = defaultClient,
    now = new Date(),
    actor = { type: "user", id: userId },
  }: RemoveOptions = {},
): Promise<Removed | null> {
  const db = scopedFor(userId, client);
  const row = await db.gmailMailboxes.findFirst({
    where: { id: mailboxId },
    select: {
      id: true,
      address: true,
      status: true,
      secretsEncrypted: true,
      accessExpiresAt: true,
    },
  });
  if (!row) return null;
  let secrets = tokensIn(row.secretsEncrypted);
  let accessExpiresAt = row.accessExpiresAt;
  let hadAccess = row.status === STATUS.active;
  const { count } = await db.gmailMailboxes.deleteMany({
    where: { id: row.id, secretsEncrypted: row.secretsEncrypted },
  });
  if (count === 0) {
    // It changed after it was read, and what is there now is deleted as it is. A read renewing the
    // access token, or key rotation sealing the value again, keeps the refresh token: the same
    // permission, still ended below. Someone else connecting the address wiped the tokens, and the
    // person connecting it again brought a new permission after this began: nothing is sent for
    // either.
    const changed = await db.gmailMailboxes.findFirst({
      where: { id: row.id },
      select: { status: true, secretsEncrypted: true, accessExpiresAt: true },
    });
    if (!changed) return null;
    const { count: deleted } = await db.gmailMailboxes.deleteMany({ where: { id: row.id } });
    if (deleted === 0) return null;
    hadAccess = changed.status === STATUS.active;
    const current = hadAccess ? tokensIn(changed.secretsEncrypted) : NO_SECRETS;
    const same = secrets.refreshToken !== null && current.refreshToken === secrets.refreshToken;
    secrets = same ? current : NO_SECRETS;
    accessExpiresAt = changed.accessExpiresAt;
  }
  // The refresh token ends the whole permission; the access token goes only when it's all there is.
  const ending = secrets.refreshToken ?? secrets.accessToken;
  let endedAtGoogle = false;
  if (ending !== null && !(await heldByAnyone(row.address, { client }))) {
    // Best effort, and before the permission ends, since Gmail would turn the token away after.
    const accessGood = accessExpiresAt !== null && accessExpiresAt > now;
    if (secrets.accessToken !== null && accessGood) await stopWatch(secrets.accessToken);
    endedAtGoogle = await revokeTokens([ending]);
  }
  await logAudit(
    actor,
    "gmail_disconnected",
    { type: "gmail_mailbox", id: row.id },
    { user_id: userId, reason, ended_at_google: endedAtGoogle },
  );
  await track(userId, "gmail_disconnected", { reason });
  return { endedAtGoogle, hadAccess };
}

// Each of the person's mailboxes, as removeMailbox removes one: when they delete their data, and
// in the inactivity clean-up.
export async function removeAllMailboxes(
  userId: string,
  reason: RemovalReason,
  { client = defaultClient, now = new Date(), actor }: RemoveOptions = {},
): Promise<void> {
  const rows = await scopedFor(userId, client).gmailMailboxes.findMany({ select: { id: true } });
  for (const { id } of rows) await removeMailbox(userId, id, reason, { client, now, actor });
}
