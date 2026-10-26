"use server";

import { redirect } from "next/navigation";
import { isHiddenPage } from "@/config/hidden-pages";
import { LoanApplicationError, prepareApplication } from "@/lib/loan-applications";
import { TransferError, endTransfer, startTransfer } from "@/lib/balance-transfers";
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
  // While the application page is hidden (src/config/hidden-pages.ts), back to the offers.
  redirect(isHiddenPage("/loans/apply/x") ? "/loans/refinance" : `/loans/apply/${id}`);
}

// Spec step 113: the person moved a card's balance to a 0% card, or paid that off.
async function transferStep(step: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await step();
  } catch (error) {
    if (error instanceof TransferError) {
      redirect(`/loans/refinance?${new URLSearchParams({ error: error.message })}#transfers`);
    }
    throw error;
  }
  redirect(`/loans/refinance?transfer=${done}#transfers`);
}

export async function startTransferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await transferStep(
    () =>
      startTransfer(user.id, {
        debtKey: String(formData.get("debtKey") ?? ""),
        offerId: String(formData.get("offerId") ?? ""),
      }),
    "started",
  );
}

export async function endTransferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await transferStep(() => endTransfer(user.id, String(formData.get("id") ?? ""), "done"), "done");
}
