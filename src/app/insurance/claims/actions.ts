"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ClaimError,
  closeClaim,
  markStepDone,
  saveClaimNumber,
  startClaim,
} from "@/lib/insurance/claims";
import { requireUser } from "@/lib/session";

// The claims page (spec step 107). Each goes back to /insurance/claims at the claim.

export type StartClaimState = { message: string } | null;

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

export async function newClaim(
  _previous: StartClaimState,
  formData: FormData,
): Promise<StartClaimState> {
  const user = await requireUser();
  let id: string;
  try {
    const policy = text(formData, "policy");
    const [policyId, kind] = policy.startsWith("kind:") ? [null, policy.slice(5)] : [policy, ""];
    id = (
      await startClaim(user.id, {
        policyId,
        kind,
        event: text(formData, "event"),
        happenedOn: text(formData, "happenedOn"),
      })
    ).id;
  } catch (error) {
    if (error instanceof ClaimError) return { message: error.message };
    throw error;
  }
  // The same page with only a new hash: refreshed, so the new claim shows.
  revalidatePath("/insurance/claims");
  redirect(`/insurance/claims#claim-${id}`);
}

// A step, the claim number or closing: problems just go back to the page, which shows the
// claim as it is.
async function onClaim(
  formData: FormData,
  run: (userId: string, claimId: string) => Promise<unknown>,
) {
  const user = await requireUser();
  const claimId = text(formData, "claimId");
  try {
    await run(user.id, claimId);
  } catch (error) {
    if (!(error instanceof ClaimError)) throw error;
  }
  revalidatePath("/insurance/claims");
  redirect(`/insurance/claims#claim-${claimId}`);
}

export async function stepDone(formData: FormData): Promise<void> {
  await onClaim(formData, (userId, claimId) =>
    markStepDone(userId, claimId, text(formData, "step")),
  );
}

export async function claimNumber(formData: FormData): Promise<void> {
  await onClaim(formData, (userId, claimId) =>
    saveClaimNumber(userId, claimId, text(formData, "claimNumber")),
  );
}

export async function finishClaim(formData: FormData): Promise<void> {
  await onClaim(formData, (userId, claimId) => closeClaim(userId, claimId));
}
