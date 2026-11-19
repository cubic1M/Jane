"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GMAIL_LIMITS, GMAIL_PAGE_PATH } from "@/config/gmail";
import { removeMailbox } from "@/lib/gmail/mailbox";
import { NOTICE_COOKIE, sealNotice, type NoticeWord } from "@/lib/gmail/notice";
import { requireUser } from "@/lib/session";

// Disconnect on /settings/mailboxes: deletes one of the signed-in person's mailboxes and what was
// read through it, and asks Google to end the permission when that ends no one else's copy
// (src/lib/gmail/mailbox.ts). What happened goes back to the page in a cookie only the server can
// make (src/lib/gmail/notice.ts), so the address bar can't say a mailbox is gone. Neither the
// switch nor KILL_BANKS stops it: taking access away always works.

// A mailbox's id is a cuid.
const ID = /^[a-z0-9]{1,40}$/i;

export async function disconnectMailbox(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formData.get("mailboxId");
  // Someone else's mailbox, or one already gone, removes nothing and leaves no word.
  const removed =
    typeof id === "string" && ID.test(id)
      ? await removeMailbox(user.id, id, "user_disconnected")
      : null;
  if (removed) {
    const word: NoticeWord = removed.endedAtGoogle
      ? "disconnected"
      : removed.hadAccess
        ? "disconnected_unconfirmed"
        : "disconnected_no_access";
    (await cookies()).set(NOTICE_COOKIE, sealNotice(user.id, word, new Date()), {
      httpOnly: true,
      // An action has no address of its own to look at, so as src/lib/auth-actions.ts does.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: GMAIL_PAGE_PATH,
      maxAge: GMAIL_LIMITS.noticeSeconds,
    });
  }
  revalidatePath(GMAIL_PAGE_PATH);
  // Settings shows how many there are.
  revalidatePath("/settings");
  redirect(GMAIL_PAGE_PATH);
}
