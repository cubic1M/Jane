"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CollegeError, startCollegePlan } from "@/lib/investments/college";
import { requireUser } from "@/lib/session";

// College savings from its page (spec step 158).

export type CollegeState = { message: string } | null;

export async function saveCollegePlan(
  _previous: CollegeState,
  formData: FormData,
): Promise<CollegeState> {
  const user = await requireUser();
  try {
    await startCollegePlan(user.id, {
      childName: String(formData.get("childName") ?? ""),
      childAge: Number(formData.get("childAge") ?? NaN),
      type: formData.get("type") === "private" ? "private" : "public",
    });
  } catch (error) {
    if (error instanceof CollegeError) return { message: error.message };
    throw error;
  }
  revalidatePath("/goals");
  redirect("/investments/college?saved=1");
}
