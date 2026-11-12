"use server";

import { revalidatePath } from "next/cache";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { emailInvite, type InviteEmailResult } from "@/lib/invite-email";
import { createInviteCode, normalizeCode, revokeInviteCode } from "@/lib/invites";
import { hit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/session";

export type InviteState = { ok: boolean; message: string; code?: string } | null;

const EMAIL_WORDS: Record<InviteEmailResult, string> = {
  sent: "Emailed it.",
  not_found: "That code isn't one of the team's.",
  not_locked: "Only a code made for one email can be emailed: copy the link instead.",
  not_active: "That code no longer works, so it wasn't emailed.",
  failed: "The email didn't send (see /admin/health). Copy the link instead.",
};

// Emails the code to the address it's locked to, audited by the code's id (never the address).
async function sendAndAudit(adminId: string, adminEmail: string | null | undefined, code: string) {
  const { result, id } = await emailInvite(code, { replyTo: adminEmail ?? undefined });
  if (result === "sent" && id) {
    await logAudit({ type: "admin", id: adminId }, "invite_code_emailed", {
      type: "invite_code",
      id,
    });
  }
  return result;
}

const MAX_USES = 500;

export async function createInvite(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const admin = await requireAdmin();
  // Each code lets someone in: even an admin's session makes only so many an hour.
  if (!(await hit("invites", admin.id)).ok) {
    return { ok: false, message: "That's a lot of codes for one hour. Please wait and try again." };
  }
  const uses = Number(formData.get("maxUses"));
  if (!Number.isInteger(uses) || uses < 1 || uses > MAX_USES) {
    return { ok: false, message: `Uses must be a whole number from 1 to ${MAX_USES}.` };
  }
  const note =
    String(formData.get("note") ?? "")
      .trim()
      .slice(0, 200) || null;
  // Optional: only this address may use the code.
  const email = String(formData.get("email") ?? "").trim() || null;
  if (email && (!email.includes("@") || email.length > 254)) {
    return { ok: false, message: "Enter a valid email address, or leave it blank for anyone." };
  }
  const days = Number(formData.get("expiresInDays") || 0);
  const expiresAt =
    Number.isInteger(days) && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

  const { id, code } = await createInviteCode({
    maxUses: uses,
    note,
    expiresAt,
    email,
    createdById: admin.id,
  });
  // The note and the email stay out of the logs: a code id and its shape only.
  await logAudit(
    { type: "admin", id: admin.id },
    "invite_code_created",
    { type: "invite_code", id },
    {
      uses,
      lockedToEmail: email !== null,
      expires: expiresAt !== null,
    },
  );
  await track(admin.id, "invite_created", { uses, locked_to_email: email !== null });
  // "Email it to them now": one step from a student's address to an invite in their inbox.
  const sent =
    email && formData.get("send") === "on" ? await sendAndAudit(admin.id, admin.email, code) : null;
  revalidatePath("/admin/invites");
  return {
    ok: sent === null || sent === "sent",
    message: `Created ${code}${sent ? `. ${EMAIL_WORDS[sent]}` : ""}`,
    code,
  };
}

// Emails (or emails again) an active code to the address it's locked to.
export async function sendInvite(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!(await hit("invites", admin.id)).ok) return;
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (code) await sendAndAudit(admin.id, admin.email, code);
  revalidatePath("/admin/invites");
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const code = normalizeCode(String(formData.get("code") ?? ""));
  const revoked = code ? await revokeInviteCode(code) : null;
  if (revoked) {
    await logAudit({ type: "admin", id: admin.id }, "invite_code_revoked", {
      type: "invite_code",
      id: revoked.id,
    });
    await track(admin.id, "invite_revoked", {});
  }
  revalidatePath("/admin/invites");
}
