"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { TaxProfileError, confirmFound, savePayStub, saveTaxAnswers } from "@/lib/tax-profile";
import {
  ResidencyError,
  loadResidency,
  saveLocality,
  saveMoves,
  saveWorkState,
} from "@/lib/tax-states";
import { loadTaxProfile } from "@/lib/tax-profile";
import { defaultTaxYear } from "@/planning/tax-pack";
import { FamilyTaxesError, saveFamilyDetails } from "@/lib/family-taxes";
import { HomeTaxesError, saveHomeAnswers } from "@/lib/home-taxes";
import { SideIncomeError, saveSideIncomeAnswers } from "@/lib/side-income";
import {
  answersFrom,
  familyFrom,
  homeFrom,
  payStubFrom,
  residencyFrom,
  sideIncomeFrom,
} from "./answers";
import { scopedFor } from "@/lib/db-scoped";
import { ignoring } from "@/lib/ignoring";
import { todayOf } from "@/lib/today";

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
      const moveYear = Number(entry.move.date.slice(0, 4));
      // The form shows only the first of several moves: an edit to it keeps the others.
      const { told } = await loadResidency(user.id, moveYear);
      const later = told && told.length > 1 ? told.slice(1) : [];
      // The form shows only the first move, so a date past the next one would reorder them and a
      // repeat of the same form would then keep the wrong move: refuse it instead.
      if (later.length > 0 && entry.move.date >= later[0]!.date)
        return {
          ok: false,
          message: `Moves are kept in date order. Pick a date before ${later[0]!.date}, the next move you told me about.`,
        };
      const same = (m: { date: string; from: string; to: string }) =>
        m.date === entry.move?.date && m.from === entry.move.from && m.to === entry.move.to;
      if (!(later.length > 0 && same(told![0]!)))
        await saveMoves(user.id, moveYear, [entry.move, ...later], { now, via: "page" });
    } else if (entry.oneState) {
      await saveMoves(user.id, defaultTaxYear(await todayOf(user.id, { now })), [], {
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

// Spec step 169: family details for the family tax choices.
export async function saveFamilyAction(
  _previous: TaxProfileState,
  formData: FormData,
): Promise<TaxProfileState> {
  const user = await requireUser();
  try {
    await saveFamilyDetails(user.id, familyFrom(formData), { via: "page" });
    revalidatePath("/taxes");
    revalidatePath("/taxes/profile");
    return { ok: true, message: "Saved. Your family tax choices use it now." };
  } catch (error) {
    if (error instanceof FamilyTaxesError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 170: points and a home sale.
export async function saveHomeAction(
  _previous: TaxProfileState,
  formData: FormData,
): Promise<TaxProfileState> {
  const user = await requireUser();
  const now = new Date();
  try {
    const year = defaultTaxYear(await todayOf(user.id, { now }));
    const stored = await scopedFor(user.id).taxProfiles.findFirst({ select: { pointsYear: true } });
    const answers = homeFrom(formData, year, stored?.pointsYear ?? null);
    await saveHomeAnswers(user.id, answers, { now, via: "page" });
    revalidatePath("/taxes");
    revalidatePath("/taxes/profile");
    return { ok: true, message: "Saved. Your home's taxes use it now." };
  } catch (error) {
    if (error instanceof HomeTaxesError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 173: a rental's property, and hobby or business.
export async function saveSideIncomeAction(
  _previous: TaxProfileState,
  formData: FormData,
): Promise<TaxProfileState> {
  const user = await requireUser();
  try {
    await saveSideIncomeAnswers(user.id, sideIncomeFrom(formData), {
      now: new Date(),
      via: "page",
    });
    revalidatePath("/taxes");
    revalidatePath("/taxes/profile");
    return { ok: true, message: "Saved. Your estimate uses it now." };
  } catch (error) {
    if (error instanceof SideIncomeError) return { ok: false, message: error.message };
    throw error;
  }
}

// "Yes, these are my dependants": the children Jane found in the household the person listed
// for insurance, saved as their answer with one tap (from /taxes or the tax profile).
export async function confirmDependants(formData: FormData): Promise<void> {
  const user = await requireUser();
  // Only the counts the person was shown: if the household changed since the page was drawn, the
  // page is drawn again with the new counts and nothing is saved.
  const { dependants } = await loadTaxProfile(user.id);
  const shown = (name: string) => String(formData.get(name) ?? "");
  if (
    shown("childrenUnder17") === String(dependants.childrenUnder17) &&
    shown("otherDependants") === String(dependants.otherDependants)
  ) {
    await ignoring(TaxProfileError, () => confirmFound(user.id, "dependants", { via: "page" }));
  }
  revalidatePath("/taxes");
  revalidatePath("/taxes/profile");
}
