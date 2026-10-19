"use server";

import { redirect } from "next/navigation";
import { LoanApplicationError, prepareApplication } from "@/lib/loan-applications";
import { checkRates } from "@/lib/refinance";
import { requireUser } from "@/lib/session";

// "Check rates now" on /loans/refinance (spec step 111): a soft check with the lender
// partner, the same one Jane runs every month. Nothing is applied for.
export async function checkNow(): Promise<void> {
  const user = await requireUser();
  const quotes = await checkRates(user.id);
  redirect(quotes === null ? "/loans/refinance" : "/loans/refinance?checked=1");
}

// "Apply with …" (spec step 112): prepares the application and opens it for review.
// Nothing is sent to the lender until the person submits it there.
export async function applyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  let id: string;
  try {
    id = (
      await prepareApplication(user.id, {
        debtKey: String(formData.get("debtKey") ?? ""),
        lender: String(formData.get("lender") ?? ""),
      })
    ).id;
  } catch (error) {
    if (error instanceof LoanApplicationError) {
      redirect(`/loans/refinance?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/apply/${id}`);
}
