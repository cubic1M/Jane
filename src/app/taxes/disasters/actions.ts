"use server";

import { revalidatePath } from "next/cache";
import { DisasterError, applyRelief, recordDisasterLoss } from "@/lib/disasters";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Disaster relief from the page (spec step 270), as the chat's buttons do it: moving the tax
// deadlines a postponement covers, and keeping the loss with the insurance claim, once.
// Nothing is filed.

export type DisasterState = { ok: boolean; message: string } | null;

export async function disasterAction(
  _previous: DisasterState,
  formData: FormData,
): Promise<DisasterState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  const relief = String(formData.get("relief") ?? "");
  try {
    if (intent === "move") {
      const moved = await applyRelief(user.id, relief, { via: "page" });
      revalidatePath("/taxes/disasters");
      return {
        ok: true,
        message:
          moved.length === 0
            ? "None of your deadlines needed moving."
            : `Done: ${moved.length === 1 ? "1 tax deadline" : `${moved.length} tax deadlines`} moved to ${moved[0].to}.`,
      };
    }
    if (intent === "loss") {
      const row = await recordDisasterLoss(user.id, relief);
      revalidatePath("/taxes/disasters");
      return {
        ok: true,
        message: `Kept${row.claimId ? " with your insurance claim" : ""}: ${row.deductibleCents > 0 ? `${formatCents(row.deductibleCents)} deductible` : "nothing deductible after the floors for now"}. It's counted once.`,
      };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof DisasterError) return { ok: false, message: error.message };
    throw error;
  }
}
