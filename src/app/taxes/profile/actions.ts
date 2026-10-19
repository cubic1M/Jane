"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { TaxProfileError, savePayStub, saveTaxAnswers } from "@/lib/tax-profile";
import { ResidencyError, saveLocality, saveMoves, saveWorkState } from "@/lib/tax-states";
import { loadTaxProfile } from "@/lib/tax-profile";
import { defaultTaxYear } from "@/planning/tax-pack";
import { answersFrom, payStubFrom, residencyFrom } from "./answers";

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

// Spec step 120: the year-to-date figures from the latest pay stub.
export async function savePayStubAction(
  _previous: TaxProfileState,
  formData: FormData,
): Promise<TaxProfileState> {
  const user = await requireUser();
  try {
    const entry = payStubFrom(formData);
    await savePayStub(user.id, entry, { via: "page" });
    revalidatePath("/taxes");
    revalidatePath("/taxes/profile");
    return {
      ok: true,
      message: entry
        ? "Saved. Your estimate uses it now."
        : "Cleared. Your estimate no longer uses a pay stub.",
    };
  } catch (error) {
    if (error instanceof TaxProfileError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 165: a move (or one state all year), the employer's state and the city tax.
export async function saveResidencyAction(
  _previous: TaxProfileState,
  formData: FormData,
): Promise<TaxProfileState> {
  const user = await requireUser();
  const now = new Date();
  try {
    const entry = residencyFrom(formData);
    if (entry.move) {
      await saveMoves(user.id, Number(entry.move.date.slice(0, 4)), [entry.move], {
        now,
        via: "page",
      });
    } else if (entry.oneState) {
      await saveMoves(user.id, defaultTaxYear(now.toISOString().slice(0, 10)), [], {
        now,
        via: "page",
      });
    }
    await saveWorkState(user.id, entry.workState, { via: "page" });
    if (entry.locality) {
      const state = (await loadTaxProfile(user.id, { now })).state.value;
      await saveLocality(user.id, entry.locality, { via: "page", state });
    }
    revalidatePath("/taxes");
    revalidatePath("/taxes/profile");
    return { ok: true, message: "Saved. Your state estimate uses it now." };
  } catch (error) {
    if (error instanceof ResidencyError || error instanceof TaxProfileError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
