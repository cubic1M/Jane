"use server";

import { redirect } from "next/navigation";
import { requestQuotes } from "@/lib/insurance/quotes";
import { requireUser } from "@/lib/session";

// "Get quotes" on a policy (spec step 103): asks the insurance partner now and shows them.
export async function getQuotes(formData: FormData): Promise<void> {
  const user = await requireUser();
  const policyId = String(formData.get("policyId") ?? "");
  const result = await requestQuotes(user.id, policyId);
  if (result.kind === "unavailable" && result.reason === "not_found") redirect("/insurance");
  redirect(`/insurance/quotes?policy=${encodeURIComponent(policyId)}`);
}
