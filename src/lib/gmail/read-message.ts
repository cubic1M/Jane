import { GMAIL_LIMITS, SKIPPED_LABELS } from "@/config/gmail";
import type { PrismaClient } from "@/generated/prisma/client";
import type { anthropic } from "@/lib/anthropic";
import type { ScopedDb } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { todayFor } from "@/lib/today";
import { getMessage, type Access } from "./api";
import { GoogleCallError } from "./google";
import { countRead, giveBackRead } from "./limits";
import { mailMeta, rawBody, type MailMeta } from "./message";
import { readMoneyMail } from "./read-mail";
import { screenMail } from "./screen";
import { carriesSecret, forReader, htmlToText, subjectForReader } from "./text";

// One email a read meets (./sync.ts), from its history record to a saved reading or a skip. The
// steps go from what costs nothing to what costs most: the record's labels, then the few headers the
// screen needs (./screen.ts), and only for an email a company wrote about money the whole email and
// then Claude (./read-mail.ts). A skip is only ever what belongs to this one email. Anything that is
// the mailbox's, Google's, Claude's or the database's leaves, for the read to decide. Nothing from
// an email is kept but a reading's facts, and nothing from it is logged.

// Why an email was passed over: for the read's counts and the tests, never stored.
type Skip =
  // The screen's (./screen.ts).
  | "label"
  | "unverified"
  | "personal"
  | "security"
  | "no_money"
  // Gmail no longer has it, or its answer is one this email can't be read from.
  | "gone"
  | "shape"
  | "no_date"
  | "too_large"
  | "refused"
  | "bad_id"
  // The pure code threw on what the sender wrote: a bug, which costs this email and no other.
  | "broken"
  | "seen"
  | "sender_limit";

export type Handled =
  // Saved as a reading.
  | { outcome: "kept" }
  // Claude found it isn't about money, or names no amount and no day.
  | { outcome: "none" }
  | { outcome: "skipped"; why: Skip }
  // Claude gave no answer for this one email.
  | { outcome: "unread"; sender: string }
  // The person's count for the day or the 30 days is used up: nothing more is read for now.
  | { outcome: "waiting" }
  // Claude can't be asked: the read stops where it is.
  | { outcome: "later"; reason: string };

// What one email needs of the read it is part of.
export type MessageRead = {
  db: ScopedDb;
  client: PrismaClient;
  now: Date;
  mailboxId: string;
  access: Access;
  claude: typeof anthropic;
  // Emails that reached Gmail in this read, which runMessages counts.
  messages: { count: number };
  // Throws when the read no longer holds the mailbox: disconnected, taken over, or the lock taken
  // by another read. Asked before every call out and before a reading is saved, so nothing is
  // fetched, sent to Claude or saved for a mailbox that is no longer this read's.
  holding: () => Promise<void>;
};

const skip = (why: Skip): Handled => ({ outcome: "skipped", why });

// What getMessage throws that belongs to this one email (./api.ts): an answer too large to take, a
// 400 for this message, an id not shaped like one. A time-out, a limit, a 5xx, a refused token and
// everything else are the mailbox's or Google's, and leave.
const EMAILS_OWN: ReadonlyMap<string, Skip> = new Map([
  ["too_large", "too_large"],
  ["http_400", "refused"],
  ["bad_id", "bad_id"],
]);

async function fetched(
  read: MessageRead,
  id: string,
  format: "metadata" | "full",
): Promise<Record<string, unknown> | Skip> {
  await read.holding();
  try {
    return (await getMessage(read.access, id, format)) ?? "gone";
  } catch (error) {
    const own = error instanceof GoogleCallError ? EMAILS_OWN.get(error.code) : undefined;
    if (own === undefined) throw error;
    log.warn("Gmail read: an email skipped", { code: own });
    return own;
  }
}

const kindOf = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

const logBroken = (error: unknown): void =>
  log.warn("Gmail read: an email couldn't be looked at", { kind: kindOf(error) });

// The pure steps run over what a stranger wrote. One that throws on it is a bug that costs this
// email, never the read.
function safely<T>(work: () => T): T | "broken" {
  try {
    return work();
  } catch (error) {
    logBroken(error);
    return "broken";
  }
}

const HOUR_MS = 60 * 60 * 1000;

type FirstLook = { meta: MailMeta; receivedAt: Date; senderDomain: string };

// Steps 2 and 3, once Gmail has answered: an answer shaped like a message, a time it arrived (the
// reading's and the reader's day both come from it), and the screen.
function firstLook(raw: unknown, now: Date): FirstLook | Skip {
  const meta = mailMeta(raw);
  if (meta === null) return "shape";
  // Gmail's time is when it took the email in, but for mail moved in through its API it can be the
  // email's own Date header, which the sender writes. A time well after the read began is no time:
  // Claude's date would be checked against a day that hasn't come, the reading would head the page,
  // and one past what the database holds would fail to save at every read.
  const latest = now.getTime() + GMAIL_LIMITS.receivedAheadHours * HOUR_MS;
  if (meta.receivedAt === null || meta.receivedAt.getTime() > latest) return "no_date";
  const screened = screenMail(meta);
  if (!screened.keep) return screened.why;
  return { meta, receivedAt: meta.receivedAt, senderDomain: screened.senderDomain };
}

// Step 6: what Claude would be sent, with links, addresses and long numbers taken out
// (./text.ts), unless it gives a code or a password, which nothing sends to Claude.
function forTheReader(raw: unknown, subject: string): { subject: string; body: string } | Skip {
  const body = rawBody(raw);
  if (body === null) return "shape";
  const mail = {
    subject: subjectForReader(subject),
    body: forReader(body.html ? htmlToText(body.text) : body.text),
  };
  // Over exactly what would be sent.
  return carriesSecret(`${mail.subject}\n${mail.body}`) ? "security" : mail;
}

export async function readMessage(
  read: MessageRead,
  added: { id: string; labelIds: string[] | null },
): Promise<Handled> {
  // 1. The record's labels, with no call. A record without labels is unknown, not unlabelled.
  if (added.labelIds?.some((label) => SKIPPED_LABELS.has(label))) return skip("label");
  // 2. Who sent it, its subject and first lines, and Google's check of the sender: no body.
  read.messages.count += 1;
  const head = await fetched(read, added.id, "metadata");
  if (typeof head === "string") return skip(head);
  // 3. The screen. Nothing more has been fetched.
  const look = safely(() => firstLook(head, read.now));
  if (typeof look === "string") return skip(look);
  // 4. Read already, by this read or an earlier one.
  const readings = await read.db.gmailReadings.count({
    where: { mailboxId: read.mailboxId, messageRef: added.id },
  });
  if (readings > 0) return skip("seen");
  // 5. Too large by Gmail's own estimate, or the whole email.
  if ((look.meta.sizeEstimate ?? 0) > GMAIL_LIMITS.mailBytesMost) return skip("too_large");
  const whole = await fetched(read, added.id, "full");
  if (typeof whole === "string") return skip(whole);
  // 6.
  const mail = safely(() => forTheReader(whole, look.meta.subject));
  if (typeof mail === "string") return skip(mail);
  // 7. One sender can't hold the person's queue; the person's own counts stop the read.
  await read.holding();
  const counted = await countRead(read.db.userId, look.senderDomain, {
    client: read.client,
    now: read.now,
  });
  if (counted === "sender_limit") return skip("sender_limit");
  if (counted === "person_limit") return { outcome: "waiting" };
  // 8.
  return askClaude(read, added.id, look, mail);
}

// Step 8: Claude's three facts, checked in ./read-mail.ts, and what becomes of them.
async function askClaude(
  read: MessageRead,
  id: string,
  { receivedAt, senderDomain }: FirstLook,
  mail: { subject: string; body: string },
): Promise<Handled> {
  // The day it arrived is the person's day, in their timezone, as the email itself means it.
  const received = await todayFor(read.db, receivedAt);
  const reading = await readMoneyMail(
    { received, from: senderDomain, ...mail },
    { claude: read.claude },
  ).catch((error: unknown) => {
    // Only the checks on Claude's answer can throw: the call's own errors come back as outcomes.
    logBroken(error);
    return null;
  });
  if (reading === null) return skip("broken");
  if (reading.outcome === "none") return { outcome: "none" };
  if (reading.outcome === "unread") return { outcome: "unread", sender: senderDomain };
  if (reading.outcome === "later") {
    await giveBackRead(read.db.userId, senderDomain, { client: read.client, now: read.now });
    return { outcome: "later", reason: reading.reason };
  }
  await read.holding();
  await read.db.gmailReadings.createMany({
    data: [
      {
        userId: read.db.userId,
        mailboxId: read.mailboxId,
        messageRef: id,
        receivedAt,
        senderDomain,
        ...reading.fact,
      },
    ],
    skipDuplicates: true,
  });
  return { outcome: "kept" };
}
