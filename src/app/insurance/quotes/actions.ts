"use server";

import { redirect } from "next/navigation";
import { shownHref } from "@/config/hidden-pages";
import { after } from "next/server";
import { runAgentNow } from "@/lib/agent/run";
import { AcceptShopError, acceptShop } from "@/lib/insurance/accept";
import { requestQuotes } from "@/lib/insurance/quotes";
import { declineShop } from "@/lib/insurance/shop";
import { requireUser } from "@/lib/session";

// "Get quotes" on a policy (spec step 103): asks the insurance partner now and shows them.
export async function getQuotes(formData: FormData): Promise<void> {
  const user = await requireUser();
  const policyId = String(formData.get("policyId") ?? "");
  const result = await requestQuotes(user.id, policyId);
  if (result.kind === "unavailable" && result.reason === "not_found") redirect("/insurance");
  redirect(`/insurance/quotes?policy=${encodeURIComponent(policyId)}`);
}

// Yes to Jane's pick (spec step 104), the same as in the chat. Goes to Actions, where the
// switch shows its progress.
export async function switchToPick(formData: FormData): Promise<void> {
  const user = await requireUser();
  const shopId = String(formData.get("shopId") ?? "");
  const policyId = String(formData.get("policyId") ?? "");
  try {
    const { agentJobId } = await acceptShop(user.id, shopId);
    // Spec step 105: Jane binds the new policy right after the response.
    after(() => runAgentNow([agentJobId]));
  } catch (error) {
    if (error instanceof AcceptShopError) {
      redirect(`/insurance/quotes?policy=${encodeURIComponent(policyId)}&answered=1`);
    }
    throw error;
  }
  redirect(shownHref("/actions"));
}

// Not now: keeps the current policy this time.
export async function keepPolicy(formData: FormData): Promise<void> {
  const user = await requireUser();
  await declineShop(user.id, String(formData.get("shopId") ?? ""));
  redirect(
    `/insurance/quotes?policy=${encodeURIComponent(String(formData.get("policyId") ?? ""))}`,
  );
}
