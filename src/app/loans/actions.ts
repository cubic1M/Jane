"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DebtTermsError, clearDebtTerms, saveDebtTerms } from "@/lib/debts";
import { requireUser } from "@/lib/session";

// Terms typed for a debt the bank doesn't report (spec step 109). Back to /loans with
// ?saved=, or with the problem and the form open again.

const back = (debtKey: string, error: string) =>
  `/loans?${new URLSearchParams({ terms: debtKey, error })}#terms`;

function refreshOthers() {
  revalidatePath("/debt");
  revalidatePath("/net-worth");
  revalidatePath("/home");
}

export async function saveTerms(formData: FormData): Promise<void> {
  const user = await requireUser();
  const debtKey = String(formData.get("debtKey") ?? "");
  try {
    await saveDebtTerms(user.id, {
      debtKey,
      apr: String(formData.get("apr") ?? ""),
      minimum: String(formData.get("minimum") ?? ""),
      balance: String(formData.get("balance") ?? ""),
      payoffDate: String(formData.get("payoffDate") ?? ""),
    });
  } catch (error) {
    if (error instanceof DebtTermsError) redirect(back(debtKey, error.message));
    throw error;
  }
  refreshOthers();
  redirect("/loans?saved=terms");
}

export async function clearTerms(formData: FormData): Promise<void> {
  const user = await requireUser();
  await clearDebtTerms(user.id, String(formData.get("debtKey") ?? ""));
  refreshOthers();
  redirect("/loans?saved=cleared");
}
