"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { validatePartner } from "@/lib/referrals";
import { requireAdmin } from "@/lib/session";

export type PartnerState = { ok: boolean; message: string } | null;

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

export async function savePartner(
  _previous: PartnerState,
  formData: FormData,
): Promise<PartnerState> {
  const admin = await requireAdmin();
  const checked = validatePartner({
    key: field(formData, "key"),
    name: field(formData, "name"),
    actionType: field(formData, "actionType"),
    disclosure: field(formData, "disclosure"),
    referralUrl: field(formData, "referralUrl"),
    allowedStates: field(formData, "allowedStates"),
    revenuePerConversion: field(formData, "revenuePerConversion"),
    active: formData.get("active") === "on",
  });
  if (!checked.ok) return checked;
  const id = field(formData, "id");
  try {
    const saved = id
      ? await db.referralPartner.update({ where: { id }, data: checked.data, select: { id: true } })
      : await db.referralPartner.create({ data: checked.data, select: { id: true } });
    await logAudit(
      { type: "admin", id: admin.id },
      "referral_partner_saved",
      { type: "referral_partner", id: saved.id },
      { key: checked.data.key, active: checked.data.active },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: `A partner with the key "${checked.data.key}" already exists.` };
    }
    throw error;
  }
  revalidatePath("/admin/partners");
  return { ok: true, message: `Saved ${checked.data.name}.` };
}

// Turns a partner off at once: cards stop showing it on their next load, and any answer
// to a card that still showed it is refused because the card changed.
export async function turnOffPartner(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = field(formData, "id");
  const { count } = await db.referralPartner.updateMany({ where: { id }, data: { active: false } });
  if (count > 0) {
    await logAudit(
      { type: "admin", id: admin.id },
      "referral_partner_saved",
      {
        type: "referral_partner",
        id,
      },
      { active: false },
    );
  }
  revalidatePath("/admin/partners");
}
