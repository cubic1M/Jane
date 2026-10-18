"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { validateMerchant } from "@/lib/merchants";
import { requireAdmin } from "@/lib/session";

export type MerchantState = { ok: boolean; message: string } | null;

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

// Adds a merchant, or updates one when the form carries its id.
export async function saveMerchant(
  _previous: MerchantState,
  formData: FormData,
): Promise<MerchantState> {
  const admin = await requireAdmin();
  const checked = validateMerchant({
    name: field(formData, "name"),
    key: field(formData, "key"),
    aliases: field(formData, "aliases"),
    category: field(formData, "category"),
    cancelUrl: field(formData, "cancelUrl"),
    supportUrl: field(formData, "supportUrl"),
    supportPhone: field(formData, "supportPhone"),
    typicalMonthly: field(formData, "typicalMonthly"),
    reviewed: formData.get("reviewed") === "on",
  });
  if (!checked.ok) return checked;

  const id = field(formData, "id");
  const data = {
    ...checked.data,
    reviewedAt: formData.get("reviewed") === "on" ? new Date() : null,
  };
  try {
    const saved = id
      ? await db.merchant.update({ where: { id }, data, select: { id: true } })
      : await db.merchant.create({ data, select: { id: true } });
    await logAudit(
      { type: "admin", id: admin.id },
      "merchant_saved",
      {
        type: "merchant",
        id: saved.id,
      },
      { key: data.key },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: `A merchant with the key "${data.key}" already exists.` };
    }
    throw error;
  }
  revalidatePath("/admin/merchants");
  return { ok: true, message: `Saved ${data.name}.` };
}
