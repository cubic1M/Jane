"use server";

import { redirect } from "next/navigation";
import { addRental, linkDemoRental, PropertyError } from "@/lib/investments/property";
import { requireUser } from "@/lib/session";
import { ignoring } from "@/lib/ignoring";

// The property page's form and demo button (spec step 214).

export type RentalState = { message: string } | null;

export async function saveRental(_previous: RentalState, formData: FormData): Promise<RentalState> {
  const user = await requireUser();
  const f = (name: string) => String(formData.get(name) ?? "");
  try {
    await addRental(user.id, {
      name: f("name"),
      purchase: f("purchase"),
      placedInServiceMonth: f("month"),
      placedInServiceYear: f("year"),
      cashInvested: f("cashInvested"),
      loanBalance: f("loanBalance"),
      loanRate: f("loanRate"),
      monthlyPayment: f("monthlyPayment"),
      rentMatch: f("rentMatch"),
      mortgageMatch: f("mortgageMatch"),
      taxMatch: f("taxMatch"),
      expenseMatch: f("expenseMatch"),
    });
  } catch (error) {
    if (error instanceof PropertyError) return { message: error.message };
    throw error;
  }
  redirect("/investments/property?done=saved");
}

export async function demoRental(): Promise<void> {
  const user = await requireUser();
  await ignoring(PropertyError, () => linkDemoRental(user.id));
  redirect("/investments/property?done=linked");
}
