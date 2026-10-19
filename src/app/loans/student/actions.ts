"use server";

import { redirect } from "next/navigation";
import { StudentProfileError, markStudentStep, saveStudentProfile } from "@/lib/student-loans";
import { requireUser } from "@/lib/session";

// The student loan page (spec step 114): what the plans are compared with, and a
// studentaid.gov step done.

export async function saveProfile(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await saveStudentProfile(user.id, {
      agi: String(formData.get("agi") ?? ""),
      familySize: String(formData.get("familySize") ?? ""),
      dependants: String(formData.get("dependants") ?? ""),
      borrower: String(formData.get("borrower") ?? ""),
      publicService: formData.get("publicService") === "on",
      countedBefore: String(formData.get("countedBefore") ?? ""),
    });
  } catch (error) {
    if (error instanceof StudentProfileError) {
      redirect(`/loans/student?${new URLSearchParams({ error: error.message })}#about-you`);
    }
    throw error;
  }
  redirect("/loans/student?saved=1");
}

export async function stepDone(): Promise<void> {
  const user = await requireUser();
  await markStudentStep(user.id);
  redirect("/loans/student#steps");
}
