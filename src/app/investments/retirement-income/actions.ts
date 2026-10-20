"use server";

import { redirect } from "next/navigation";
import { RetirementIncomeError, saveRetirementIncome } from "@/lib/investments/retirement-income";
import { requireUser } from "@/lib/session";

// The retirement income form (spec step 212): what the person tells Jane, all optional.

export type IncomeState = { message: string } | null;

export async function saveIncome(_previous: IncomeState, formData: FormData): Promise<IncomeState> {
  const user = await requireUser();
  const field = (name: string) => String(formData.get(name) ?? "");
  try {
    await saveRetirementIncome(user.id, {
      ssMonthly: field("ssMonthly"),
      retireAge: field("retireAge"),
      ssStartAge: field("ssStartAge"),
      spendMonthly: field("spendMonthly"),
    });
  } catch (error) {
    if (error instanceof RetirementIncomeError) return { message: error.message };
    throw error;
  }
  redirect("/investments/retirement-income?done=saved");
}
