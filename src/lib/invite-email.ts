import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { escapeHtml } from "@/lib/escape-html";
import { sendEmail } from "@/lib/email";
import { inviteStatus } from "@/lib/invites";
import { log } from "@/lib/log";
import { siteOrigin } from "@/lib/site-origin";
import { systemDb } from "@/lib/system-db";

const WHY = "Invite codes are the team's own, sent from /admin/invites";

// Emails a beta invite to the one address its code is locked to, from /admin/invites: the sign-up
// link with the code in it, and the code itself. Never the team's note. Only an active code locked
// to an email can be sent, so a code for anyone is never mailed to a stranger, and a try's address
// never gets mail (src/lib/email.ts).

export type InviteEmailResult = "sent" | "not_found" | "not_locked" | "not_active" | "failed";

export const signUpLink = (code: string) =>
  `${siteOrigin() ?? "http://localhost:3000"}/signup?invite=${encodeURIComponent(code)}`;

// How long the code still works, in whole days: the student's timezone isn't known yet.
function daysLeft(expiresAt: Date | null, now: Date): string {
  if (!expiresAt) return "";
  const days = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000));
  return ` It works for ${days === 1 ? "1 more day" : `${days} more days`}.`;
}

export function renderInviteEmail(code: string, expiresAt: Date | null, now = new Date()) {
  const link = signUpLink(code);
  const until = daysLeft(expiresAt, now);
  const lines = [
    "You're invited to try Jane, in a small closed beta.",
    "Jane links your bank read-only, finds money you're losing (fees, subscriptions, interest, idle cash) and lays out the steps to get it back. It never moves money.",
    `Sign up here: ${link}`,
    `Your invite code, if it asks: ${code}.${until}`,
    "Questions or feedback: reply to this email, or use Send feedback in the app.",
  ];
  return {
    subject: "Your invite to Jane's beta",
    text: lines.join("\n\n"),
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#171717;line-height:1.5">
<p>${escapeHtml(lines[0])}</p>
<p>${escapeHtml(lines[1])}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#171717;color:#fff;text-decoration:none;font-weight:600">Sign up</a></p>
<p>Your invite code, if it asks: <b style="font-family:monospace">${escapeHtml(code)}</b>.${escapeHtml(until)}</p>
<p style="color:#525252">${escapeHtml(lines[4])}</p>
</div>`,
  };
}

export async function emailInvite(
  code: string,
  {
    client = defaultClient,
    now = new Date(),
    send = sendEmail,
    replyTo,
  }: { client?: PrismaClient; now?: Date; send?: typeof sendEmail; replyTo?: string } = {},
): Promise<{ result: InviteEmailResult; id?: string }> {
  const invite = await systemDb(WHY, client).inviteCode.findUnique({
    where: { code },
    select: {
      id: true,
      email: true,
      revokedAt: true,
      expiresAt: true,
      uses: true,
      maxUses: true,
      sharedById: true,
    },
  });
  if (!invite || invite.sharedById) return { result: "not_found" };
  if (!invite.email) return { result: "not_locked", id: invite.id };
  if (inviteStatus(invite, now) !== "active") return { result: "not_active", id: invite.id };
  try {
    await send({
      to: invite.email,
      ...renderInviteEmail(code, invite.expiresAt, now),
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (error) {
    log.error("Invite email failed", { error: String(error) });
    return { result: "failed", id: invite.id };
  }
  await systemDb(WHY, client).inviteCode.update({
    where: { id: invite.id },
    data: { emailedAt: now },
  });
  return { result: "sent", id: invite.id };
}
