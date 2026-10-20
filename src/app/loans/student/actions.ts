"use server";

import { redirect } from "next/navigation";
import { StudentProfileError, markStudentStep, saveStudentProfile } from "@/lib/student-loans";
import { StudentDatesError, saveStudentDates } from "@/lib/student-long-game";
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

// The long game (spec step 225): federal or private, and the dates to certify the employer
// and recertify income, which become deadlines.
export async function saveDates(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await saveStudentDates(user.id, {
      loanType: String(formData.get("loanType") ?? ""),
      lastCertifiedOn: String(formData.get("lastCertifiedOn") ?? ""),
      recertifyOn: String(formData.get("recertifyOn") ?? ""),
    });
  } catch (error) {
    if (error instanceof StudentDatesError) {
      redirect(`/loans/student?${new URLSearchParams({ error: error.message })}#long-game`);
    }
    throw error;
  }
  redirect("/loans/student?dates=1#long-game");
}
