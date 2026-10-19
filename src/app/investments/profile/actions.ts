"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveProfileForm } from "@/lib/investments/profile";
import { requireUser } from "@/lib/session";
import { ProfileError } from "@/planning/investor-profile";

// The investor profile form (spec step 129): every answer at once. A save goes back to the
// page with ?saved=1.

export type ProfileFormInput = {
  age: string;
  horizon: string;
  dropReaction: string;
  goals: string[];
};
export type ProfileState = { message: string; input: ProfileFormInput } | null;

const inputOf = (formData: FormData): ProfileFormInput => ({
  age: String(formData.get("age") ?? ""),
  horizon: String(formData.get("horizon") ?? ""),
  dropReaction: String(formData.get("dropReaction") ?? ""),
  goals: formData.getAll("goals").map(String),
});

export async function saveProfile(
  _previous: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const user = await requireUser();
  const input = inputOf(formData);
  try {
    await saveProfileForm(user.id, input);
  } catch (error) {
    if (error instanceof ProfileError) return { message: error.message, input };
    throw error;
  }
  revalidatePath("/investments");
  redirect("/investments/profile?saved=1");
}
