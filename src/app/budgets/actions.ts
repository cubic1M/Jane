"use server";

import { revalidatePath } from "next/cache";
import { BudgetError, removeBudget, setBudget } from "@/lib/budgets";
import { requireUser } from "@/lib/session";

export type BudgetState = { ok: boolean; message: string } | null;

export async function saveBudget(_previous: BudgetState, formData: FormData): Promise<BudgetState> {
  const user = await requireUser();
  try {
    await setBudget(
      user.id,
      String(formData.get("category") ?? ""),
      String(formData.get("amount") ?? ""),
    );
  } catch (error) {
    if (error instanceof BudgetError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/budgets");
  revalidatePath("/home");
  return { ok: true, message: "Saved." };
}

export async function deleteBudget(formData: FormData): Promise<void> {
  const user = await requireUser();
  await removeBudget(user.id, String(formData.get("category") ?? ""));
  revalidatePath("/budgets");
  revalidatePath("/home");
}
