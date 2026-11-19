import { GMAIL_LIMITS, gmailNoticesOn, gmailOpen } from "@/config/gmail";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import type { anthropic } from "@/lib/anthropic";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { meteredClaude } from "@/lib/claude-budget";
import { db as defaultClient } from "@/lib/db";
import { personTransaction, scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { ownedByStaying, STAYING, type OnlyPeople } from "@/lib/only-people";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { systemDb } from "@/lib/system-db";
import { isTrialUser } from "@/lib/trial-ids";
import { getProfile, listHistory, listRecent, watch, type Access } from "./api";
import {
  GmailGrantGoneError,
  GmailHistoryGoneError,
  GmailSignedOutError,
  GoogleCallError,
} from "./google";
import { readerReady } from "./limits";
import { refreshTokens } from "./oauth";
import { readMessage, type Handled, type MessageRead, type Reading } from "./read-message";
import { NO_SECRETS, openSecrets, sealSecrets, type GmailSecrets } from "./secrets";

// Reading a Gmail mailbox (docs/setup/gmail.md): what arrived after the saved place in its history,
// one email at a time (./read-message.ts), with the place saved after every record, so a stop
// anywhere loses no mail and repeats little. A read is started by a notice from Google
// (syncFromNotice), by connecting (the callback), and by the daily job (refreshAllGmail). One read
// per mailbox at a time, under a lock that outlives the function, and every write a read makes
// matches only while the mailbox is still active, the lock still its own and the tokens still the
// ones it opened: a disconnect, a take-over, connecting it again, a key rotation or a lost lock
// stops it quietly. Once a read has its row, an expected failure ends up there as a code of ours,
// never thrown; the database failing before then (taking the lock, reading the row) is thrown to
// the caller. Nothing here logs an address, a token or anything an email says.

export type SyncOutcome =
  "read" | "off" | "busy" | "backing_off" | "waiting" | "reconnect" | "failed" | "none";

type Options = {
  client?: PrismaClient;
  now?: Date;
  clock?: () => number;
  budgetMs?: number;
  runMessages?: number;
  claude?: typeof anthropic;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const WHY_NOTICE = "A notice from Google names a mailbox, not a person: finds who holds it";
const WHY_DUE = "Cron: finds every Gmail mailbox due a read, whoever holds it";
// Gmail's history ids are digits, past what a JavaScript number holds: compared only as BigInt.
const HISTORY_ID = /^\d{1,20}$/;

// The tokens a read holds, and the sealed value they were last saved as.
type Tokens = { secrets: GmailSecrets; sealed: string; expiresAt: Date | null };

// One read of one mailbox, from the moment it holds the lock. `now` is the lock's own mark too:
// every write the read makes matches only while the row still carries it.
type Locked = {
  db: ScopedDb;
  client: PrismaClient;
  userId: string;
  mailboxId: string;
  now: Date;
  clock: () => number;
  // When the read stops starting new emails: one deadline for everything the call starts.
  deadline: number;
  runMessages: number;
  claude: typeof anthropic;
};

// The same read once it has read its row under the lock: the tokens it opened, renewed in place.
type Read = Locked & { tokens: Tokens };

// A write matched nothing: the mailbox was disconnected, taken over or connected again, its tokens
// were sealed again, or another read took the lock. The read stops quietly, with no audit row, no
// ops event and no failure.
class LockLost extends Error {
  constructor() {
    super("The read no longer holds this mailbox");
    this.name = "LockLost";
  }
}

// A read that can't go on, for a reason of ours: the code goes on the row.
class ReadFailed extends Error {
  constructor(readonly code: string) {
    super(`Gmail read failed: ${code}`);
    this.name = "ReadFailed";
  }
}

const kindOf = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

// 4. What every write of a read matches on. The sealed tokens too: connecting the mailbox again
// saves new ones and a key rotation seals the same ones again, and either way a read that opened
// the old value stops, rather than write its ending over the row they left.
const held = ({ mailboxId, now, tokens }: Read) => ({
  id: mailboxId,
  status: "active",
  syncingSince: now,
  secretsEncrypted: tokens.sealed,
});

async function save(read: Read, data: Prisma.GmailMailboxUpdateManyMutationInput): Promise<void> {
  const { count } = await read.db.gmailMailboxes.updateMany({ where: held(read), data });
  if (count === 0) throw new LockLost();
}

// The same test with nothing written, before each call out (./read-message.ts asks it too).
async function holding(read: Read): Promise<void> {
  if ((await read.db.gmailMailboxes.count({ where: held(read) })) === 0) throw new LockLost();
}

// A reading, in one transaction that first writes the read's own lock again: a take-over or a
// reconnect that came first leaves nothing saved and stops the read, and one that comes while it
// runs waits for it. Its statements aren't filtered for the person, so each names them.
async function saveReading(read: Read, reading: Reading): Promise<void> {
  await personTransaction(
    read.userId,
    async (tx) => {
      const { count } = await tx.gmailMailbox.updateMany({
        where: { ...held(read), userId: read.userId },
        data: { syncingSince: read.now },
      });
      if (count === 0) throw new LockLost();
      await tx.gmailReading.createMany({
        data: [{ ...reading, userId: read.userId, mailboxId: read.mailboxId }],
        skipDuplicates: true,
      });
    },
    read.client,
  );
}

// 2. One statement, so two reads can't both take it. A lock older than lockMinutes was left by a
// read that died, and is taken over; a mailbox waiting out a failure isn't read before its time.
async function lock(db: ScopedDb, mailboxId: string, now: Date): Promise<boolean> {
  const lapsed = new Date(now.getTime() - GMAIL_LIMITS.lockMinutes * MINUTE);
  const { count } = await db.gmailMailboxes.updateMany({
    where: {
      id: mailboxId,
      status: "active",
      AND: [
        { OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }] },
        { OR: [{ syncingSince: null }, { syncingSince: { lt: lapsed } }] },
      ],
    },
    data: { syncingSince: now },
  });
  return count === 1;
}

async function whyNotLocked(db: ScopedDb, mailboxId: string, now: Date): Promise<SyncOutcome> {
  const row = await db.gmailMailboxes.findFirst({
    where: { id: mailboxId },
    select: { status: true, nextTryAt: true },
  });
  if (row?.status === "reconnect") return "reconnect";
  if (!row || row.status !== "active") return "none";
  if (row.nextTryAt !== null && row.nextTryAt > now) return "backing_off";
  return "busy";
}

// 3. Lets go of this read's own lock only: one taken over from it is the other read's. Whatever the
// tokens are now: a read stopped by a reconnect still lets the next one in.
async function release({ db, mailboxId, now }: Locked): Promise<void> {
  try {
    await db.gmailMailboxes.updateMany({
      where: { id: mailboxId, syncingSince: now },
      data: { syncingSince: null },
    });
  } catch (error) {
    // It lapses by itself after lockMinutes.
    log.error("Gmail read: lock not let go", { kind: kindOf(error) });
  }
}

// 5. A value that won't open is a failed read, and nothing is wiped: a missing or wrong key gives
// the same error for every mailbox, and wiping then would end every connection that works.
function opened(sealed: string): GmailSecrets {
  try {
    return openSecrets(sealed);
  } catch {
    throw new ReadFailed("secrets_unreadable");
  }
}

const expiring = ({ secrets, expiresAt }: Tokens, now: Date): boolean =>
  !secrets.accessToken ||
  (expiresAt !== null &&
    expiresAt.getTime() - now.getTime() < GMAIL_LIMITS.tokenMarginSeconds * 1000);

// 6. A new access token, saved at once. Google keeps the refresh token it gave (./oauth.ts hands
// back the one it was given when it sends none). Only invalid_grant means connecting again.
async function renew(read: Read): Promise<string> {
  const { tokens } = read;
  const { refreshToken } = tokens.secrets;
  if (!refreshToken) throw new GmailGrantGoneError();
  await holding(read);
  const fresh = await refreshTokens(refreshToken, { now: read.now });
  const secrets = {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken ?? refreshToken,
  };
  const sealed = sealSecrets(secrets);
  // Saved only over the value this read opened or last saved (held). No match: a reconnect saved
  // newer tokens, or a key rotation sealed these again, and the read stops.
  await save(read, { secretsEncrypted: sealed, accessExpiresAt: fresh.expiresAt });
  tokens.secrets = secrets;
  tokens.sealed = sealed;
  tokens.expiresAt = fresh.expiresAt;
  return fresh.accessToken;
}

// Gmail turning a token away renews it once and repeats that one call (./api.ts). A second refusal
// leaves as GmailSignedOutError: a failed read, never a reason to connect again.
const accessFor = (read: Read): Access => ({
  token: async () => read.tokens.secrets.accessToken ?? "",
  renew: () => renew(read),
});

// 7. Google's notices end after a week unless asked for again. A watch Google refuses doesn't stop
// the read: the mailbox is still read, by the daily job if not by notices, and the watch stays due,
// so every read asks again until one works. Answers whether a refusal stands, this read's or one
// still on the row: a read that then gets to everything leaves `watch_failed` (codeAfter).
async function keepNoticesComing(
  read: Read,
  access: Access,
  row: { watchExpiresAt: Date | null; lastErrorCode: string | null },
): Promise<boolean> {
  const standing = row.lastErrorCode === "watch_failed";
  const renewFrom = read.now.getTime() + GMAIL_LIMITS.watchRenewHours * HOUR;
  const due = row.watchExpiresAt === null || row.watchExpiresAt.getTime() < renewFrom;
  if (!gmailNoticesOn() || !due) return standing;
  await holding(read);
  const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim() ?? "";
  // Refused or not answered: Google's words go nowhere, only our code. A token Google no longer
  // takes, and everything else, leave as they would from any call.
  const answer = await watch(access, topic).catch((error: unknown) => {
    if (error instanceof GoogleCallError) return error;
    throw error;
  });
  if (answer instanceof GoogleCallError) {
    // Written only over no code: one already on the row says more (a failure, Claude's, the emails
    // `reader_unread` put the cursor back for, mail left `unfinished`), and a read that stops before
    // it gets anywhere leaves it as it was. Its ending writes `watch_failed` when it got to
    // everything (codeAfter); until then the watch is still due, and the next read asks again.
    if (row.lastErrorCode === null) await save(read, { lastErrorCode: "watch_failed" });
    log.warn("Gmail notices not renewed", { code: answer.code });
    await recordOpsEvent("gmail_read_failed", {
      code: "WATCH_FAILED",
      userId: read.userId,
      client: read.client,
      now: read.now,
    });
    return true;
  }
  await save(read, {
    watchExpiresAt: answer.expiresAt,
    ...(standing ? { lastErrorCode: null } : {}),
  });
  return false;
}

// Emails Claude gave no answer for, in a row: their senders, where the cursor stood before the first
// of them, and whether that one was the look-back's.
type Streak = { senders: Set<string>; cursorBefore: string; lookingBack: boolean };

// What one read has done so far: where its cursor stands, the emails it has met, and its counts.
type Run = {
  cursor: string;
  // The cursor this read started from, when the read before put it back there for emails Claude
  // gave no answer for (`reader_unread`). Null after any other ending.
  putBack: string | null;
  // Whether the mailbox had never been read through (lastCheckedAt null) when this read began.
  neverRead: boolean;
  met: Set<string>;
  messages: { count: number };
  kept: number;
  none: number;
  skipped: Record<string, number>;
  streak: Streak | null;
  lookedBack: boolean;
  // The look-back stopped by the deadline or runMessages with emails it never got to.
  lookBackCut: boolean;
  jumped: boolean;
  // Whether Gmail has answered a listing yet: a read that ran out of time before it did read
  // nothing, and isn't a success (readHeld).
  listed: boolean;
};

// How reading new mail ended: everything read, stopped by the deadline or runMessages with history
// left or the look-back not begun, the person's count used up, Claude not to be asked (`later`), or
// emails Claude gave no answer for one after another (`unread`). Both of those last say where the
// cursor goes back to: before the first of the emails Claude gave no answer for, when there are any.
type Ended =
  | { end: "done" | "left" | "waiting" }
  | { end: "later"; reason: string; cursorBack: string | null }
  | { end: "unread"; cursorBack: string };

// The deadline alone: before each email of a record too. A read stopped inside a record leaves the
// cursor before it, so the next read meets all its emails again, which runMessages would count again:
// a record longer than runMessages would never be got past.
const pastDeadline = (read: Read): boolean => read.clock() >= read.deadline;

// Between records and between the look-back's emails: the deadline, or as many emails as one read
// asks Gmail for.
const timeIsUp = (read: Read, run: Run): boolean =>
  pastDeadline(read) || run.messages.count >= read.runMessages;

const countSkip = (run: Run, why: string): void => {
  run.skipped[why] = (run.skipped[why] ?? 0) + 1;
};

// Whether a streak is the emails the read before stopped for, met again. In the history it begins
// at the very cursor that read put back. The look-back has no cursor of its own and goes over the
// same emails from the top at every read, so any streak in it counts: told apart by the cursor, it
// would stop again every read that found new mail first.
const metAgain = (run: Run, streak: Streak): boolean =>
  run.putBack !== null && (streak.lookingBack || streak.cursorBefore === run.putBack);

// Counts one email's end. `readerRefusalsInARow` emails in a row that Claude gave no answer for,
// from different senders, mean Claude is down, not that the emails are odd: the read ends as
// `unread`, with the cursor back before the first of them. A read that meets the same ones again
// takes them as odd after all: they stay skipped and it goes on, so they hold a mailbox for one
// wait at most. An email Claude did answer ends the streak. Claude found down (`later`) while a
// streak is open takes the streak's emails for the start of it: the cursor goes back before them
// too, and they are read again at the next try.
function noted(run: Run, handled: Handled, lookingBack: boolean): Ended | null {
  if (handled.outcome === "kept" || handled.outcome === "none") {
    run[handled.outcome] += 1;
    run.streak = null;
    return null;
  }
  if (handled.outcome === "skipped") {
    countSkip(run, handled.why);
    return null;
  }
  if (handled.outcome === "unread") {
    countSkip(run, "unread");
    run.streak ??= { senders: new Set(), cursorBefore: run.cursor, lookingBack };
    run.streak.senders.add(handled.sender);
    if (run.streak.senders.size < GMAIL_LIMITS.readerRefusalsInARow) return null;
    if (metAgain(run, run.streak)) {
      run.streak = null;
      return null;
    }
    return { end: "unread", cursorBack: run.streak.cursorBefore };
  }
  if (handled.outcome === "waiting") return { end: "waiting" };
  return { end: "later", reason: handled.reason, cursorBack: run.streak?.cursorBefore ?? null };
}

// Each email once in a read, whichever records name it.
async function oneEmail(
  run: Run,
  mail: MessageRead,
  added: { id: string; labelIds: string[] | null },
  { lookingBack }: { lookingBack: boolean },
): Promise<Ended | null> {
  if (run.met.has(added.id)) return null;
  run.met.add(added.id);
  return noted(run, await readMessage(mail, added), lookingBack);
}

// 9. The newest emails of the last lookBackDays, newest first (cut short, it is the oldest that are
// left out, not the latest bills and receipts), sharing the read's deadline and
// runMessages: once, after the history passes, in a read of a mailbox never read through, and once
// after a gap. It is best effort, and done once it ends: run to its end, it records a never-read
// mailbox as read through at once, whatever stops the read after it; cut short by the deadline or
// runMessages, it ends the read as done, with what it left out counted and `unfinished` on the row,
// since mail that came while it ran wasn't listed again. Either way it isn't looked back over from
// the top at the next read, so a mailbox with more recent mail than one read has time for is read
// through all the same. Ended by `later`, or by the person's count, it isn't done, and the next
// read tries it again. With no time left it isn't begun.
async function lookBack(
  read: Read,
  run: Run,
  access: Access,
  mail: MessageRead,
): Promise<Ended | null> {
  if (timeIsUp(read, run)) return { end: "left" };
  run.lookedBack = true;
  await holding(read);
  const newestFirst = await listRecent(access, {
    days: GMAIL_LIMITS.lookBackDays,
    most: GMAIL_LIMITS.lookBackMessages,
  });
  run.listed = true;
  for (const [index, id] of newestFirst.entries()) {
    if (timeIsUp(read, run)) {
      const leftOut = newestFirst.slice(index).filter((other) => !run.met.has(other)).length;
      if (leftOut > 0) {
        run.skipped.look_back_cut = leftOut;
        run.lookBackCut = true;
      }
      return { end: "done" };
    }
    const ended = await oneEmail(run, mail, { id, labelIds: null }, { lookingBack: true });
    if (ended) return ended;
  }
  // Said now: left to the read's end, Claude or a failure in the history listed next would leave the
  // mailbox never read through, and the next read would look back over all of it again.
  if (run.neverRead) await save(read, { lastCheckedAt: read.now });
  return null;
}

// Saves the cursor when it moves forward. Answers whether it did.
async function moveCursor(read: Read, run: Run, id: string): Promise<boolean> {
  if (BigInt(id) <= BigInt(run.cursor)) return false;
  await save(read, { historyCursor: id });
  run.cursor = id;
  return true;
}

// 10. One pass over what arrived after the cursor, every page, oldest first, with the cursor saved
// after each record. Answers whether the pass found a record, or how the read ended part way: a
// stop inside a record leaves the cursor before it.
async function onePass(
  read: Read,
  run: Run,
  access: Access,
  mail: MessageRead,
): Promise<Ended | { found: boolean }> {
  const start = run.cursor;
  let found = false;
  let firstPageId: string | null = null;
  let pageToken: string | null = null;
  do {
    if (pageToken !== null && timeIsUp(read, run)) return { end: "left" };
    await holding(read);
    const page = await listHistory(access, start, pageToken);
    run.listed = true;
    firstPageId ??= page.historyId;
    for (const record of page.records) {
      if (timeIsUp(read, run)) return { end: "left" };
      for (const added of record.added) {
        // One record can name many emails, and the deadline doesn't wait for all of them.
        if (pastDeadline(read)) return { end: "left" };
        const ended = await oneEmail(run, mail, added, { lookingBack: false });
        if (ended) return ended;
      }
      if (await moveCursor(read, run, record.id)) found = true;
    }
    pageToken = page.nextPageToken;
  } while (pageToken !== null);
  // Every page read: the mailbox's place on the first page is safe whether the later pages were a
  // snapshot or live, and a mailbox where nothing arrived moves on too.
  if (firstPageId !== null) await moveCursor(read, run, firstPageId);
  return { found };
}

// Gmail no longer keeps the history after the cursor: carry on from its place now, note that
// emails before now were missed, and look back over the newest, once a read.
async function jumpAhead(
  read: Read,
  run: Run,
  access: Access,
  mail: MessageRead,
): Promise<Ended | null> {
  run.jumped = true;
  // Gmail answered the listing, with where its history now begins.
  run.listed = true;
  await holding(read);
  const { historyId } = await getProfile(access);
  await save(read, { historyCursor: historyId, missedAt: read.now });
  run.cursor = historyId;
  // Emails before the gap can't be read again, so a streak there can't send the cursor back.
  run.streak = null;
  log.warn("Gmail read lost its place", { mailboxId: read.mailboxId });
  await recordOpsEvent("gmail_history_gap", {
    userId: read.userId,
    client: read.client,
    now: read.now,
  });
  return run.lookedBack ? null : lookBack(read, run, access, mail);
}

// 10 and 9: passes over the history until one finds nothing new, the deadline or runMessages; then,
// while the mailbox has never been read through, the look-back once. New mail goes first: a first
// read whose look-back took all its time never got to what arrived after connecting, and the next
// read began the look-back again. History left before the look-back ends the read as `left`, and the
// look-back waits for a read that gets through it. A look-back that runs to its end records the
// mailbox as read through as it ends (lookBack), so what stops the read after it isn't a reason to
// look back again. After a pass that handled mail, and after a look-back that ran to its end, the
// read lists once more, so a notice that found the lock held loses nothing. A read that stops before
// then, with history left or its look-back cut short, leaves `unfinished` on the row (succeeded):
// what came in meanwhile is read by the next notice, or by the daily job at its next run.
async function readNewMail(read: Read, run: Run, access: Access): Promise<Ended> {
  const mail: MessageRead = {
    db: read.db,
    client: read.client,
    now: read.now,
    mailboxId: read.mailboxId,
    access,
    claude: read.claude,
    messages: run.messages,
    holding: () => holding(read),
    saveReading: (reading) => saveReading(read, reading),
  };
  for (;;) {
    if (timeIsUp(read, run)) return { end: "left" };
    let pass: Ended | { found: boolean };
    try {
      pass = await onePass(read, run, access, mail);
    } catch (error) {
      // One jump a read: a place Gmail still can't find after it is a failed read.
      if (!(error instanceof GmailHistoryGoneError) || run.jumped) throw error;
      const ended = await jumpAhead(read, run, access, mail);
      if (ended) return ended;
      continue;
    }
    if ("end" in pass) return pass;
    if (pass.found) continue;
    if (!run.neverRead || run.lookedBack) return { end: "done" };
    const ended = await lookBack(read, run, access, mail);
    if (ended) return ended;
  }
}

// `later` (./read-mail.ts): Claude couldn't be asked part way. The read stops at the last finished
// record, or before the emails Claude gave no answer for just before (noted), and is tried again
// after readerRetryMinutes. `unread`: the same, with the cursor back before the first of the emails
// Claude was taken to be down for, and `reader_unread` on the row, so the next read knows them if
// they stop it again (noted). Not the mailbox failing: no failure is counted, no audit row is
// written, and one ops event says why.
async function readerDown(
  read: Read,
  ended:
    | { end: "later"; reason: string; cursorBack: string | null }
    | { end: "unread"; cursorBack: string },
): Promise<void> {
  await save(read, {
    ...(ended.cursorBack !== null ? { historyCursor: ended.cursorBack } : {}),
    nextTryAt: new Date(read.now.getTime() + GMAIL_LIMITS.readerRetryMinutes * MINUTE),
    lastErrorCode: ended.end === "unread" ? "reader_unread" : "reader_later",
  });
  const reason = ended.end === "unread" ? "UNREAD" : ended.reason;
  log.warn("Gmail read stopped: Claude couldn't be asked", { reason });
  await recordOpsEvent("gmail_reader_down", {
    code: reason,
    userId: read.userId,
    client: read.client,
    now: read.now,
  });
}

// Whether the emails the read before put the cursor back for (`reader_unread`) are still ahead of
// it: once the cursor is past them that stop is spent, and the mark goes.
const stillPutBack = (run: Run): boolean => run.putBack !== null && run.cursor === run.putBack;

// The code a read that got through leaves. Stopped short of the emails the read before put the
// cursor back for, it keeps their mark, a failed watch or not: the next read lets them go only with
// it. Otherwise mail the read didn't get to, history left or a look-back cut short, is `unfinished`,
// over a failed watch's code too, so the daily job always sees a mailbox with mail left: it takes
// it at its next run, and a read that gets through clears it. Nothing is lost by that: the watch is
// asked for again whenever it is due (keepNoticesComing), and the page's once-a-day line follows
// the watch's end, not the code. Only a read that got to everything leaves `watch_failed`.
function codeAfter(run: Run, { watchFailed, left }: { watchFailed: boolean; left: boolean }) {
  if (left && stillPutBack(run)) return "reader_unread";
  if (left || run.lookBackCut) return "unfinished";
  return watchFailed ? "watch_failed" : null;
}

// 11. A read that stopped with history left doesn't say it was checked; only a look-back that ran
// to its end has said so already (lookBack).
async function succeeded(
  read: Read,
  run: Run,
  { watchFailed, left }: { watchFailed: boolean; left: boolean },
): Promise<void> {
  await save(read, {
    lastErrorCode: codeAfter(run, { watchFailed, left }),
    failures: 0,
    nextTryAt: null,
    ...(left ? {} : { lastCheckedAt: read.now }),
  });
  log.info("Gmail read", {
    mailboxId: read.mailboxId,
    kept: run.kept,
    none: run.none,
    skipped: run.skipped,
  });
}

// A code of ours for the row, the audit log and the team, never the server's words.
function failureCode(error: unknown): string {
  if (error instanceof ReadFailed || error instanceof GoogleCallError) return error.code;
  if (error instanceof GmailSignedOutError) return "refused_after_renewal";
  if (error instanceof GmailHistoryGoneError) return "history_gone";
  if (kindOf(error).startsWith("PrismaClient")) return "database";
  return "unexpected";
}

const backoffUntil = (failures: number, now: Date): Date =>
  new Date(
    now.getTime() +
      Math.min(
        GMAIL_LIMITS.backoffMinutes * MINUTE * 2 ** Math.min(failures - 1, 16),
        GMAIL_LIMITS.backoffMostHours * HOUR,
      ),
  );

// 12. Google no longer accepts the refresh token: only connecting again helps. The tokens are
// wiped only if they are still the ones this read holds (held), so a reconnect that saved new ones
// keeps them. Answers whether it wrote.
async function needsReconnect(read: Read): Promise<boolean> {
  const { count } = await read.db.gmailMailboxes.updateMany({
    where: held(read),
    data: {
      status: "reconnect",
      secretsEncrypted: sealSecrets(NO_SECRETS),
      accessExpiresAt: null,
      nextTryAt: null,
      watchExpiresAt: null,
      lastErrorCode: "signed_out",
    },
  });
  if (count === 0) return false;
  log.warn("Gmail mailbox needs connecting again", { mailboxId: read.mailboxId });
  await logAudit(
    SYSTEM_ACTOR,
    "gmail_reconnect_needed",
    { type: "gmail_mailbox", id: read.mailboxId },
    { user_id: read.userId },
  );
  await track(read.userId, "gmail_reconnect_needed");
  return true;
}

// 12. Any other expected failure: counted, with a wait that doubles from backoffMinutes up to
// backoffMostHours, and our code on the row, in the audit log and to the team. Answers whether it
// wrote: nothing is written for a mailbox this read no longer holds.
async function recordFailure(read: Read, error: unknown): Promise<boolean> {
  const code = failureCode(error);
  const current = await read.db.gmailMailboxes.findFirst({
    where: { id: read.mailboxId },
    select: { failures: true },
  });
  const failures = (current?.failures ?? 0) + 1;
  const { count } = await read.db.gmailMailboxes.updateMany({
    where: held(read),
    data: { failures, nextTryAt: backoffUntil(failures, read.now), lastErrorCode: code },
  });
  if (count === 0) return false;
  // A bug says what kind of error it was, never what it said.
  log.error("Gmail read failed", {
    code,
    ...(code === "unexpected" ? { kind: kindOf(error) } : {}),
  });
  await logAudit(
    SYSTEM_ACTOR,
    "gmail_read_failed",
    { type: "gmail_mailbox", id: read.mailboxId },
    { user_id: read.userId, code, failures },
  );
  await recordOpsEvent("gmail_read_failed", {
    code: code.toUpperCase(),
    userId: read.userId,
    client: read.client,
    now: read.now,
  });
  return true;
}

async function failed(read: Read, error: unknown): Promise<SyncOutcome> {
  if (error instanceof LockLost) return "none";
  try {
    if (error instanceof GmailGrantGoneError) {
      return (await needsReconnect(read)) ? "reconnect" : "none";
    }
    return (await recordFailure(read, error)) ? "failed" : "none";
  } catch (recording) {
    log.error("Gmail read failure not recorded", { kind: kindOf(recording) });
    return "failed";
  }
}

// Steps 3 to 12, holding the lock.
async function readHeld(locked: Locked): Promise<SyncOutcome> {
  // 3. Read under the lock, so nothing another read changes is acted on twice.
  const row = await locked.db.gmailMailboxes.findFirst({
    where: { id: locked.mailboxId },
    select: {
      secretsEncrypted: true,
      accessExpiresAt: true,
      historyCursor: true,
      watchExpiresAt: true,
      lastCheckedAt: true,
      lastErrorCode: true,
    },
  });
  if (!row) return "none";
  const read: Read = {
    ...locked,
    tokens: { secrets: NO_SECRETS, sealed: row.secretsEncrypted, expiresAt: row.accessExpiresAt },
  };
  try {
    // 5.
    read.tokens.secrets = opened(row.secretsEncrypted);
    // Only Gmail's digits are a place: a row the access proof planted carries text that isn't.
    if (!HISTORY_ID.test(row.historyCursor)) throw new ReadFailed("bad_cursor");
    const access = accessFor(read);
    // 6.
    if (expiring(read.tokens, read.now)) await renew(read);
    // 7.
    const watchFailed = await keepNoticesComing(read, access, row);
    // 8. Known before anything is read: nothing is recorded and nothing backs off, and the token and
    // the watch were kept alive above.
    const ready = await readerReady(read.userId, { client: read.client, now: read.now });
    if (!ready.ok) return "waiting";
    // 9 and 10.
    const run: Run = {
      cursor: row.historyCursor,
      putBack: row.lastErrorCode === "reader_unread" ? row.historyCursor : null,
      neverRead: row.lastCheckedAt === null,
      met: new Set(),
      messages: { count: 0 },
      kept: 0,
      none: 0,
      skipped: {},
      streak: null,
      lookedBack: false,
      lookBackCut: false,
      jumped: false,
      listed: false,
    };
    const ended = await readNewMail(read, run, access);
    if (ended.end === "waiting") {
      // `reader_unread` names the emails at the place the read before put back. Once the cursor is
      // past them that stop is spent: left on the row, it would let the next read pass over a streak
      // where the cursor stands now, which no read ever went back for.
      if (run.putBack !== null && run.cursor !== run.putBack) {
        await save(read, { lastErrorCode: watchFailed ? "watch_failed" : null });
      }
      return "waiting";
    }
    if (ended.end === "later" || ended.end === "unread") {
      await readerDown(read, ended);
      return "waiting";
    }
    // Out of time before Gmail listed anything: nothing was read, so this is no success. The code,
    // the failures and the wait stay as they were, a failing mailbox's and `reader_unread` alike.
    if (ended.end === "left" && !run.listed) return "read";
    // 11.
    await succeeded(read, run, { watchFailed, left: ended.end === "left" });
    return "read";
  } catch (error) {
    // 12.
    return failed(read, error);
  }
}

// Reads one person's mailbox, from where reading last stopped. Whatever goes wrong once it has
// read the row under its lock is recorded there as a code of ours (a bug as `unexpected`, as
// Robinhood's refresh does), never thrown, and the person's page says so. The database failing
// before then, taking the lock or reading the row, is thrown for the caller to catch.
export async function syncMailbox(
  userId: string,
  mailboxId: string,
  {
    client = defaultClient,
    now = new Date(),
    clock = Date.now,
    budgetMs = GMAIL_LIMITS.runBudgetMs,
    runMessages = GMAIL_LIMITS.runMessages,
    claude = meteredClaude(userId),
  }: Options = {},
): Promise<SyncOutcome> {
  // 1. A trial person's data is a sample: never read.
  if (!gmailOpen()) return "off";
  if (isTrialUser(userId)) return "off";
  const deadline = clock() + budgetMs;
  const db = scopedFor(userId, client);
  // 2.
  if (!(await lock(db, mailboxId, now))) return whyNotLocked(db, mailboxId, now);
  const locked: Locked = {
    db,
    client,
    userId,
    mailboxId,
    now,
    clock,
    deadline,
    runMessages,
    claude,
  };
  try {
    return await readHeld(locked);
  } finally {
    await release(locked);
  }
}

// A notice from Google names a mailbox and nothing else. The newest active row for that address is
// read: one Jane person holds a mailbox at a time, and a trial person is never read.
export async function syncFromNotice(
  address: string,
  { client = defaultClient, ...options }: Options = {},
): Promise<SyncOutcome> {
  if (!gmailOpen()) return "off";
  const row = await systemDb(WHY_NOTICE, client).gmailMailbox.findFirst({
    where: { address, status: "active", userId: STAYING },
    select: { id: true, userId: true },
    orderBy: { updatedAt: "desc" },
  });
  return row ? syncMailbox(row.userId, row.id, { client, ...options }) : "none";
}

type GmailRun = {
  read: number;
  waiting: number;
  failed: number;
  reconnect: number;
  deferred: number;
};

// The daily job (src/app/api/cron/gmail/route.ts), the backstop for notices that didn't come. Due:
// an active mailbox whose wait is over, and that wasn't read through in staleHours, or whose last
// read left a code (any: a failure, Claude's, `unfinished`, `watch_failed`), or whose notices need
// asking for. Oldest checked first, each with the smaller of nightMailboxBudgetMs and what is left
// of the run; those past it wait for tomorrow. Two kinds need a whole read's runBudgetMs instead. A
// mailbox never read through: its look-back counts as done however short it is cut, so twenty
// seconds would leave most of its recent mail unread for good. Once the run has started another
// mailbox, it waits for tomorrow when less than a whole read is left, rather than start short. And
// one whose last read was `unfinished`: it may have stopped inside a record with more emails than
// twenty seconds get through. It gets a whole read when one fits, as the run's first mailbox or
// with that much left, and an ordinary read otherwise, never put off: put off, one behind the same
// mailboxes every night would never be read. A read that stops short leaves it `unfinished`, with
// lastCheckedAt as it was, so it comes before the mailboxes read through since. Known limits: a
// record longer than a whole read can still hold a mailbox. And while the mailboxes before an
// `unfinished` one take more than cronBudgetMs - runBudgetMs every night, it gets twenty seconds
// every night, so a record longer than that holds it until they take less, or a notice reads it.
// Off, it reads nothing.
export async function refreshAllGmail({
  client = defaultClient,
  now = new Date(),
  userIds,
  budgetMs = GMAIL_LIMITS.cronBudgetMs,
  clock = Date.now,
}: {
  client?: PrismaClient;
  now?: Date;
  budgetMs?: number;
  clock?: () => number;
} & OnlyPeople = {}): Promise<GmailRun | null> {
  if (!gmailOpen()) return null;
  const stale = new Date(now.getTime() - GMAIL_LIMITS.staleHours * HOUR);
  const due = await systemDb(WHY_DUE, client).gmailMailbox.findMany({
    where: {
      ...ownedByStaying(userIds),
      status: "active",
      AND: [
        { OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }] },
        {
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: stale } },
            { lastErrorCode: { not: null } },
            ...(gmailNoticesOn() ? [{ watchExpiresAt: null }] : []),
          ],
        },
      ],
    },
    select: { id: true, userId: true, lastCheckedAt: true, lastErrorCode: true },
    // Then the one written longest ago. Every mailbox never read through ties at null, and a run may
    // have time for only one whole read: in the database's own order, one that never gets through
    // could take it every night while another waits. A read writes its row and a mailbox put off
    // isn't touched, so the one that waited goes first the next night.
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }],
    take: GMAIL_LIMITS.cronMailboxes,
  });
  const run: GmailRun = { read: 0, waiting: 0, failed: 0, reconnect: 0, deferred: 0 };
  const started = clock();
  // Whether a mailbox has been started yet: the first always is, so a run shorter than a whole
  // read still reads one.
  let begun = false;
  for (const { id, userId, lastCheckedAt, lastErrorCode } of due) {
    const left = budgetMs - (clock() - started);
    const neverRead = lastCheckedAt === null;
    const whole = neverRead || lastErrorCode === "unfinished";
    if (left <= 0 || (neverRead && begun && left < GMAIL_LIMITS.runBudgetMs)) {
      run.deferred += 1;
      continue;
    }
    const own =
      whole && (!begun || left >= GMAIL_LIMITS.runBudgetMs)
        ? GMAIL_LIMITS.runBudgetMs
        : GMAIL_LIMITS.nightMailboxBudgetMs;
    begun = true;
    const outcome = await syncMailbox(userId, id, {
      client,
      now,
      clock,
      budgetMs: Math.min(own, left),
    }).catch((error: unknown) => {
      log.error("Gmail read broke", { kind: kindOf(error) });
      return "failed" as const;
    });
    // Not counted: busy (another read has it), backing off, and a mailbox gone or moved since.
    if (
      outcome === "read" ||
      outcome === "waiting" ||
      outcome === "failed" ||
      outcome === "reconnect"
    )
      run[outcome] += 1;
  }
  return run;
}
