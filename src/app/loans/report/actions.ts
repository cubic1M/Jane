"use server";

import { redirect } from "next/navigation";
import { CreditFixError, sendReportLetter } from "@/lib/credit-report-fixes";
import { requireUser } from "@/lib/session";

// "Send" on /loans/report (spec step 181): one letter, only on the person's tap.
export async function sendLetterAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await sendReportLetter(user.id, String(formData.get("letterId") ?? ""));
  } catch (error) {
    if (error instanceof CreditFixError) {
      redirect(`/loans/report?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect("/loans/report?sent=1");
}
