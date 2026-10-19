"use server";

import { redirect } from "next/navigation";
import { checkRates } from "@/lib/refinance";
import { requireUser } from "@/lib/session";

// "Check rates now" on /loans/refinance (spec step 111): a soft check with the lender
// partner, the same one Jane runs every month. Nothing is applied for.
export async function checkNow(): Promise<void> {
  const user = await requireUser();
  const quotes = await checkRates(user.id);
  redirect(quotes === null ? "/loans/refinance" : "/loans/refinance?checked=1");
}
