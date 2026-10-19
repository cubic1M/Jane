"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { adviceMode } from "@/lib/advice-mode";
import { TaxOrganizerError, markTaxForm } from "@/lib/tax-organizer";
import { WithholdingError, clearW4Change, keepRefund, recordW4Change } from "@/lib/tax-withholding";

// /taxes (spec step 119): "I have it" on a tax form Jane expects, or "Not yet" to undo it.

export type FormState = { ok: boolean; message: string } | null;

export async function markForm(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const year = Number(formData.get("year"));
  const key = String(formData.get("key") ?? "");
  const received = formData.get("received") === "1";
  if (!Number.isInteger(year)) return { ok: false, message: "Something went wrong. Try again." };
  try {
    const form = await markTaxForm(user.id, year, key, received, { via: "page" });
    revalidatePath("/taxes");
    revalidatePath("/tax-pack");
    return {
      ok: true,
      message: received ? `Ticked off: ${form.form} from ${form.from}.` : "OK, still waiting.",
    };
  } catch (error) {
    if (error instanceof TaxOrganizerError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 121: the W-4 change the person sent, undoing it, or keeping a big refund.
export async function w4Action(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "sent") {
      if (!(await adviceMode(user.id)))
        return { ok: false, message: "That's only in demo advice mode." };
      const step = String(formData.get("step") ?? "");
      const amountCents = Number(formData.get("amountCents"));
      if (step !== "4b" && step !== "4c")
        return { ok: false, message: "Something went wrong. Try again." };
      await recordW4Change(user.id, { step, amountCents }, { via: "page" });
    } else if (intent === "undo") {
      await clearW4Change(user.id, { via: "page" });
    } else if (intent === "keep") {
      const year = Number(formData.get("year"));
      if (!Number.isInteger(year))
        return { ok: false, message: "Something went wrong. Try again." };
      await keepRefund(user.id, year, { via: "page" });
    } else {
      return { ok: false, message: "Something went wrong. Try again." };
    }
    revalidatePath("/taxes");
    return {
      ok: true,
      message:
        intent === "sent"
          ? "Saved. Your estimate counts it from your next paycheck."
          : intent === "undo"
            ? "OK, your estimate no longer counts it."
            : "OK. Jane won't bring it up again this year.",
    };
  } catch (error) {
    if (error instanceof WithholdingError) return { ok: false, message: error.message };
    throw error;
  }
}
