"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { TaxProfileError, saveTaxAnswers } from "@/lib/tax-profile";
import { answersFrom } from "./answers";

// The tax profile page (spec step 118): saves every field the person filled in. A field
// left empty stays unanswered, so nothing is assumed.

export type TaxProfileState = { ok: boolean; message: string } | null;

export async function saveTaxProfile(
  _previous: TaxProfileState,
  formData: FormData,
): Promise<TaxProfileState> {
  const user = await requireUser();
  try {
    const answers = answersFrom(formData);
    if (answers.length === 0) return { ok: false, message: "Fill in at least one answer." };
    await saveTaxAnswers(user.id, answers, { via: "page" });
    revalidatePath("/taxes");
    revalidatePath("/taxes/profile");
    return { ok: true, message: "Saved. I'll use these for your taxes." };
  } catch (error) {
    if (error instanceof TaxProfileError) return { ok: false, message: error.message };
    throw error;
  }
}
