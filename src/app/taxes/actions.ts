"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { TaxOrganizerError, markTaxForm } from "@/lib/tax-organizer";

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
