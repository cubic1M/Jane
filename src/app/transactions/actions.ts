"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runDetection } from "@/detection/engine";
import { CategoryError, correctCategory, removeMerchantRule } from "@/lib/categories";
import { requireUser } from "@/lib/session";

export type CategoryState = { ok: boolean; message: string } | null;

export async function saveCategory(
  _previous: CategoryState,
  formData: FormData,
): Promise<CategoryState> {
  const user = await requireUser();
  const forMerchant = formData.get("forMerchant") === "on";
  let updated: number;
  try {
    ({ updated } = await correctCategory(
      user.id,
      String(formData.get("transactionId") ?? ""),
      String(formData.get("category") ?? ""),
      { forMerchant },
    ));
  } catch (error) {
    if (error instanceof CategoryError) return { ok: false, message: error.message };
    throw error;
  }
  // Findings depend on categories (subscriptions, fees); refresh them after responding.
  after(() => runDetection(user.id));
  revalidatePath("/transactions");
  revalidatePath("/insights");
  return {
    ok: true,
    message: forMerchant
      ? `Saved for this merchant: ${updated} transaction${updated === 1 ? "" : "s"} updated, and new ones will follow.`
      : "Saved.",
  };
}

export async function deleteRule(formData: FormData): Promise<void> {
  const user = await requireUser();
  await removeMerchantRule(user.id, String(formData.get("merchantKey") ?? ""));
  revalidatePath("/transactions");
}
