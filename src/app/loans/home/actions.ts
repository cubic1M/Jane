"use server";

import { redirect } from "next/navigation";
import { HomeBuyingError, startHomeGoal } from "@/lib/home-buying";
import { requireUser } from "@/lib/session";

// "Start the goal" on /loans/home (spec step 179): a savings goal for the cash needed, only
// on the person's tap.
export async function startGoalAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const price = Number(String(formData.get("price") ?? ""));
  const down = Number(String(formData.get("downShare") ?? ""));
  try {
    await startHomeGoal(user.id, {
      priceCents: Number.isFinite(price) && price > 0 ? Math.round(price) : undefined,
      downShare: Number.isFinite(down) && down > 0 && down < 1 ? down : undefined,
      targetDate: String(formData.get("targetDate") ?? "") || undefined,
    });
  } catch (error) {
    if (error instanceof HomeBuyingError) {
      redirect(`/loans/home?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect("/loans/home?started=1");
}
