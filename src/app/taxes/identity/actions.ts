"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { IdentityError, markHavePin, markStep, openCase, remindIpPin } from "@/lib/tax-identity";
import { isSign } from "@/planning/tax-identity";

// A protected tax identity (spec step 218): the IP PIN reminder, reporting a sign, and
// ticking off each step.

export type IdentityState = { ok: boolean; message: string } | null;

export async function identityAction(
  _previous: IdentityState,
  formData: FormData,
): Promise<IdentityState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "remind") {
      const due = await remindIpPin(user.id, { via: "page" });
      revalidatePath("/taxes/identity");
      return { ok: true, message: `Getting your IP PIN is on your deadlines for ${due}.` };
    }
    if (intent === "have") {
      await markHavePin(user.id);
      revalidatePath("/taxes/identity");
      return { ok: true, message: "Good: you're protected for this year's return." };
    }
    if (intent === "open") {
      const sign = String(formData.get("sign") ?? "");
      if (!isSign(sign)) return { ok: false, message: "Pick what happened." };
      await openCase(user.id, sign, "told");
      revalidatePath("/taxes/identity");
      return { ok: true, message: "Here are the steps, in order." };
    }
    if (intent === "step") {
      const view = await markStep(user.id, String(formData.get("step") ?? ""));
      revalidatePath("/taxes/identity");
      return {
        ok: true,
        message: view.complete ? "That's every step. Keep copies of what you sent." : "Noted.",
      };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof IdentityError) return { ok: false, message: error.message };
    throw error;
  }
}
