"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DebtPlanError, startDebtPlan, stopDebtPlan } from "@/lib/debt-plan";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// The payoff plan on /debt (spec step 110): start one in an order with an extra a month,
// or stop it. Neither moves money.

export async function startPlan(formData: FormData): Promise<void> {
  const user = await requireUser();
  const extra = String(formData.get("extra") ?? "").trim();
  const extraCents = extra ? parseMoneyToCents(extra) : 0;
  try {
    await startDebtPlan(user.id, {
      strategy: formData.get("strategy"),
      extraCents: extraCents ?? -1,
    });
  } catch (error) {
    if (error instanceof DebtPlanError) {
      redirect(`/debt?${new URLSearchParams({ error: error.message })}#plan`);
    }
    throw error;
  }
  revalidatePath("/chat");
  redirect("/debt?saved=started#plan");
}

export async function stopPlan(): Promise<void> {
  const user = await requireUser();
  await stopDebtPlan(user.id);
  redirect("/debt?saved=stopped#plan");
}
