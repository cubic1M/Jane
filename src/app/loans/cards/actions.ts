"use server";

import { redirect } from "next/navigation";
import { CreditCardError, applyForCard } from "@/lib/credit-cards";
import { requireUser } from "@/lib/session";

// "Apply" on /loans/cards (spec step 174): the person's tap is the application, a hard
// credit check with the issuer. Jane never applies on its own.
export async function applyCardAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  let status: string;
  try {
    status = (await applyForCard(user.id, String(formData.get("productId") ?? ""))).status;
  } catch (error) {
    if (error instanceof CreditCardError) {
      redirect(`/loans/cards?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/cards?applied=${status}#applications`);
}
