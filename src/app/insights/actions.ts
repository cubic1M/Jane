"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { countCashIncome, declineCashIncome } from "@/categorize/cash-income";
import { runDetection } from "@/detection/engine";
import { scopedFor } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";

// The person's word on cash deposits counted as income (src/categorize/cash-income.ts): "not
// income" makes them deposits again, as their choice; "count them" undoes it.
async function decide(change: typeof declineCashIncome) {
  const user = await requireUser();
  await change(scopedFor(user.id));
  // Income feeds the forecast and the findings; refresh them after responding.
  after(() => runDetection(user.id));
  revalidatePath("/insights");
  revalidatePath("/home");
  revalidatePath("/transactions");
}

export async function notIncome(): Promise<void> {
  await decide(declineCashIncome);
}

export async function countAsIncome(): Promise<void> {
  await decide(countCashIncome);
}
