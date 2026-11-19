import { NextResponse } from "next/server";
import { GMAIL_LIMITS, GMAIL_PAGE_PATH } from "@/config/gmail";
import { NOTICE_COOKIE, sealNotice, type NoticeWord } from "@/lib/gmail/notice";

// The way back to the mailboxes page from the connect and callback routes beside this file: a 303 to
// the page's own path, with no query, and what the page says once in a cookie only the server can
// seal (src/lib/gmail/notice.ts). Nothing from the address bar goes into the answer, so a link
// someone else wrote can't make the page say a mailbox was connected.
export function backToMailboxes(origin: string, userId: string, word: NoticeWord): NextResponse {
  const response = NextResponse.redirect(new URL(GMAIL_PAGE_PATH, origin), 303);
  response.cookies.set(NOTICE_COOKIE, sealNotice(userId, word, new Date()), {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    // The callback is reached from Google's page, and this cookie has to ride the redirect after it.
    sameSite: "lax",
    path: GMAIL_PAGE_PATH,
    maxAge: GMAIL_LIMITS.noticeSeconds,
  });
  return response;
}
