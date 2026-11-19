import { GMAIL_LIMITS } from "@/config/gmail";
import { open, seal } from "./sealed";

// What the mailboxes page says once, after a connect or a disconnect sent the person back to it.
// The word travels in a cookie only the server can make (./sealed.ts), never in the address: a
// link someone else wrote can't make Jane's own page say a mailbox was connected or removed. The
// sentences are the page's; this file holds only the words and the cookie's name.

export const NOTICE_COOKIE = "jane_gmail_notice";

const NOTICE_WORDS = [
  "connected",
  // Connected, and until now it was connected to another Jane account.
  "connected_moved",
  "not_connected",
  // Google didn't grant the read-only permission.
  "not_allowed",
  "paused",
  "too_many",
  // The connect address was opened without the page's own link.
  "start_here",
  "disconnected",
  // Removed here, but Google didn't confirm that it ended the permission.
  "disconnected_unconfirmed",
  // Removed here; there was nothing left to end at Google.
  "disconnected_no_access",
] as const;

export type NoticeWord = (typeof NOTICE_WORDS)[number];

const PURPOSE = "gmail_notice";

export const sealNotice = (userId: string, word: NoticeWord, now: Date): string =>
  seal(PURPOSE, userId, word, now);

// The word a cookie holds, if it was sealed for this person a moment ago and is one of the words
// above. Anything else is null, and the page says nothing.
export function openNotice(
  value: string | null | undefined,
  userId: string,
  now: Date,
): NoticeWord | null {
  const word = open(value, PURPOSE, userId, GMAIL_LIMITS.noticeSeconds * 1000, now);
  return NOTICE_WORDS.find((known) => known === word) ?? null;
}
