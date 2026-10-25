"use server";

import { revalidatePath } from "next/cache";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { createInviteCode, normalizeCode, revokeInviteCode } from "@/lib/invites";
import { requireAdmin } from "@/lib/session";

export type InviteState = { ok: boolean; message: string; code?: string } | null;

const MAX_USES = 500;

export async function createInvite(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const admin = await requireAdmin();
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
  revalidatePath("/admin/invites");
  return { ok: true, message: `Created ${code}`, code };
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
