"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { COVERAGE_FIELDS, GAP_KEYS, isPolicyKind, type GapKey } from "@/config/insurance";
import {
  HouseholdFactsError,
  dismissGap,
  saveHousehold,
  type HouseholdInput,
} from "@/lib/insurance/household";
import {
  PolicyError,
  addPolicy,
  removePolicy,
  updatePolicy,
  type PolicyInput,
} from "@/lib/insurance/policies";
import { ReadingError, confirmReading, dismissReading } from "@/lib/insurance/readings";
import { requireUser } from "@/lib/session";

// Insurance (spec step 102). A save goes back to /insurance with ?saved=, so the
// confirmation shows on the freshly loaded profile.

export type PolicyState = { message: string; input: PolicyInput } | null;
export type HouseholdState = { message: string; input: HouseholdInput } | null;

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function policyInputOf(formData: FormData): PolicyInput {
  const kind = text(formData, "kind");
  const coverage: Record<string, string> = {};
  if (isPolicyKind(kind)) {
    for (const field of COVERAGE_FIELDS[kind]) {
      coverage[field.key] = text(formData, `coverage.${field.key}`);
    }
  }
  return {
    kind,
    carrier: text(formData, "carrier"),
    premium: text(formData, "premium"),
    premiumFrequency: text(formData, "premiumFrequency"),
    deductible: text(formData, "deductible"),
    renewalDate: text(formData, "renewalDate"),
    termMonths: text(formData, "termMonths"),
    covers: text(formData, "covers"),
    coverage,
  };
}

function refreshOthers() {
  revalidatePath("/money");
  revalidatePath("/chat");
}

export async function savePolicy(_previous: PolicyState, formData: FormData): Promise<PolicyState> {
  const user = await requireUser();
  const policyId = text(formData, "policyId");
  const input = policyInputOf(formData);
  try {
    if (policyId) await updatePolicy(user.id, policyId, input);
    else await addPolicy(user.id, input);
  } catch (error) {
    if (error instanceof PolicyError) return { message: error.message, input };
    throw error;
  }
  refreshOthers();
  redirect(`/insurance?saved=${policyId ? "updated" : "added"}`);
}

// Spec step 151: a policy read from a document, confirmed as the person left the fields.
export async function confirmReadingForm(
  _previous: PolicyState,
  formData: FormData,
): Promise<PolicyState> {
  const user = await requireUser();
  const input = policyInputOf(formData);
  try {
    await confirmReading(user.id, text(formData, "readingId"), { input });
  } catch (error) {
    if (error instanceof ReadingError) return { message: error.message, input };
    throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=read");
}

export async function dismissReadingForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await dismissReading(user.id, text(formData, "readingId"));
  } catch (error) {
    if (!(error instanceof ReadingError)) throw error;
  }
  refreshOthers();
  redirect("/insurance");
}

export async function deletePolicy(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await removePolicy(user.id, text(formData, "policyId"));
  } catch (error) {
    if (error instanceof PolicyError) redirect("/insurance");
    throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=removed");
}

export async function saveHouseholdFacts(
  _previous: HouseholdState,
  formData: FormData,
): Promise<HouseholdState> {
  const user = await requireUser();
  const input: HouseholdInput = {
    housing: text(formData, "housing"),
    vehicles: text(formData, "vehicles"),
    dependants: text(formData, "dependants"),
    pets: text(formData, "pets"),
  };
  try {
    await saveHousehold(user.id, input);
  } catch (error) {
    if (error instanceof HouseholdFactsError) return { message: error.message, input };
    throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=household");
}

export async function notNeeded(formData: FormData): Promise<void> {
  const user = await requireUser();
  const gap = text(formData, "gap");
  if ((GAP_KEYS as readonly string[]).includes(gap)) await dismissGap(user.id, gap as GapKey);
  refreshOthers();
  redirect("/insurance?saved=gap");
}
