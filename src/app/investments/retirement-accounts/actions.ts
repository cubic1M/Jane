"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  contributeToIra,
  linkDemoRothIra,
  requestMatchRaise,
  RetirementAccountsError,
} from "@/lib/investments/retirement-accounts";
import { requireUser } from "@/lib/session";

// The retirement accounts page's buttons (spec step 210). Each is the person's tap.

const BASE = "/investments/retirement-accounts";

export async function raiseForMatch(): Promise<void> {
  const user = await requireUser();
  try {
    await requestMatchRaise(user.id);
  } catch (error) {
    if (!(error instanceof RetirementAccountsError)) throw error;
    redirect(`${BASE}?done=changed`);
  }
  redirect(`${BASE}?done=requested`);
}

export async function putInIra(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await contributeToIra(user.id, Math.round(Number(formData.get("cents"))));
  } catch (error) {
    if (!(error instanceof RetirementAccountsError)) throw error;
    redirect(`${BASE}?done=changed`);
  }
  revalidatePath("/investments");
  redirect(`${BASE}?done=contributed`);
}

export async function linkRothIra(): Promise<void> {
  const user = await requireUser();
  try {
    await linkDemoRothIra(user.id);
  } catch (error) {
    if (!(error instanceof RetirementAccountsError)) throw error;
  }
  revalidatePath("/investments");
  redirect(`${BASE}?done=linked`);
}
