"use server";

import { redirect } from "next/navigation";
import {
  CreditGoalError,
  completeGoalItems,
  endCreditGoal,
  startCreditGoal,
} from "@/lib/credit-goals";
import { requireUser } from "@/lib/session";

// On /loans/goal (spec step 227): start a plan for a score, tick off a month's items, end it.

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CreditGoalError) {
      redirect(`/loans/goal?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/goal?${done}=1`);
}

export async function startGoalAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    () =>
      startCreditGoal(user.id, {
        kind: String(formData.get("kind") ?? ""),
        targetScore: Number(String(formData.get("targetScore") ?? "")),
        targetDate: String(formData.get("targetDate") ?? ""),
      }),
    "started",
  );
}

export async function tickItemAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    () =>
      completeGoalItems(user.id, String(formData.get("goalId") ?? ""), [
        String(formData.get("key") ?? ""),
      ]),
    "ticked",
  );
}

export async function endGoalAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => endCreditGoal(user.id, String(formData.get("goalId") ?? "")), "ended");
}
