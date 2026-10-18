"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { createInviteCode } from "@/lib/invites";
import { requireAdmin } from "@/lib/session";

export type InviteState = { ok: boolean; message: string } | null;

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
  const days = Number(formData.get("expiresInDays") || 0);
  const expiresAt =
    Number.isInteger(days) && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

  const { code } = await createInviteCode({ maxUses: uses, note, expiresAt });
  await logAudit({ type: "admin", id: admin.id }, "invite_code_created", null, { uses, note });
  revalidatePath("/admin/invites");
  return { ok: true, message: `Created ${code}` };
}
