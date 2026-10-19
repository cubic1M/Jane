"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { placeRebalance, RebalanceError } from "@/lib/investments/rebalance";
import { requireUser } from "@/lib/session";

// "Move to the recommended mix" from the page (spec step 133): the plan's key, checked
// again on the server, then back to the page with the confirmations.

export type RebalanceState = { message: string } | null;

export async function rebalanceNow(
  _previous: RebalanceState,
  formData: FormData,
): Promise<RebalanceState> {
  const user = await requireUser();
  try {
    await placeRebalance(user.id, String(formData.get("key") ?? ""));
  } catch (error) {
    if (error instanceof RebalanceError) return { message: error.message };
    throw error;
  }
  revalidatePath("/investments");
  redirect("/investments/rebalance?done=1");
}
