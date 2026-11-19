import { createHmac, randomBytes } from "node:crypto";
import { GMAIL_MONTH_SHARE } from "@/config/gmail";
import type { PrismaClient } from "@/generated/prisma/client";
import { llmEnabled } from "@/lib/anthropic";
import { backgroundCapHit } from "@/lib/claude-budget";
import { db as defaultClient } from "@/lib/db";
import { monthlyCapCents, monthlySpentCents } from "@/lib/jane-agent/claude-limits";
import { giveBack, hit, wouldPass } from "@/lib/rate-limit";

// How much of Claude reading mail may use (docs/setup/gmail.md): whether Claude may be asked for a
// person's mail at all right now, and a count of the emails it reads for them, per day and per 30
// days, and per sender per day. Mail is never let use up what the rest of Jane needs: it stops once
// the month's spend for all of Claude passes GMAIL_MONTH_SHARE of the cap. The counters are the
// rate limits' own (src/config/rate-limits.ts). No key names a mailbox or a sender, in any form a
// list of domains could find again: a sender's is keyed with a secret. Nothing here calls Claude or
// Google.

type Options = { client?: PrismaClient; now?: Date };

// Why Claude may not be asked: it is off (no key, or KILL_CLAUDE), the person has used their own
// share, or everyone's mail has stopped for the month.
type ReaderReady = { ok: true } | { ok: false; why: "off" | "person" | "everyone" };

// Whether Claude may be asked for this person's mail now. Asked before a read takes anything from
// Google's answer to Claude, and by the mailboxes page, which says so when it may not.
export async function readerReady(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReaderReady> {
  if (!llmEnabled()) return { ok: false, why: "off" };
  const shareCents = monthlyCapCents() * GMAIL_MONTH_SHARE;
  if ((await monthlySpentCents({ client, now })) >= shareCents) {
    return { ok: false, why: "everyone" };
  }
  if (await backgroundCapHit(userId, { client, now })) return { ok: false, why: "person" };
  for (const name of ["gmailReads", "gmailReadsMonth"] as const) {
    if (!(await wouldPass(name, userId, { client, now }))) return { ok: false, why: "person" };
  }
  return { ok: true };
}

// Without AUTH_SECRET (most tests: a deployment has it, as the launch check asks), a key made when
// this process started and kept nowhere. A sender's counts then last as long as the process, and
// still name nobody. An empty AUTH_SECRET is none: a key everyone knows would make the HMAC a plain
// hash again.
const PROCESS_KEY = randomBytes(32);

// One sender's counter for one person: an HMAC keyed with the site's secret, as unsubscribe links
// are (src/lib/digest/unsubscribe.ts). A plain hash of a domain is found again by hashing a list of
// domains, so it would say who wrote to them. The person is in what is keyed, so one sender's
// counters for two people don't match either. The key ends with the person's id, so deleting their
// account clears it (src/lib/account-deletion.ts).
function senderSubject(userId: string, senderDomain: string): string {
  const keyed = createHmac("sha256", process.env.AUTH_SECRET || PROCESS_KEY)
    .update(`gmail_sender:${userId}:${senderDomain}`)
    .digest("hex")
    .slice(0, 32);
  return `${keyed}:${userId}`;
}

// One more use, kept only when the limit allows it: a refused one goes back at once, so a counter
// only ever holds emails that were read.
async function counted(
  name: "gmailSenderReads" | "gmailReads" | "gmailReadsMonth",
  subject: string,
  options: Required<Options>,
): Promise<boolean> {
  if ((await hit(name, subject, options)).ok) return true;
  await giveBack(name, subject, options);
  return false;
}

// Counts one email Claude is about to read. The sender's count first: one company's flood is
// skipped (`sender_limit`) and can't use up the person's day for the rest of their mail. Then the
// person's day and 30 days: past either, nothing more is read for them until it passes
// (`person_limit`). Whatever is refused is given back, so nothing is counted for an email not read.
export async function countRead(
  userId: string,
  senderDomain: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<"ok" | "sender_limit" | "person_limit"> {
  const options = { client, now };
  const sender = senderSubject(userId, senderDomain);
  if (!(await counted("gmailSenderReads", sender, options))) return "sender_limit";
  if (!(await counted("gmailReads", userId, options))) {
    await giveBack("gmailSenderReads", sender, options);
    return "person_limit";
  }
  if (!(await counted("gmailReadsMonth", userId, options))) {
    await giveBack("gmailReads", userId, options);
    await giveBack("gmailSenderReads", sender, options);
    return "person_limit";
  }
  return "ok";
}

// Claude couldn't be asked after all (`later`): the email wasn't read, so it isn't counted.
export async function giveBackRead(
  userId: string,
  senderDomain: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const options = { client, now };
  await giveBack("gmailSenderReads", senderSubject(userId, senderDomain), options);
  await giveBack("gmailReads", userId, options);
  await giveBack("gmailReadsMonth", userId, options);
}
