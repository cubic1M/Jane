"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FamilyError, giveGift } from "@/lib/investments/family";
import { hit, ipKey } from "@/lib/rate-limit";

// A relative's gift (spec step 213). Signed out: the link is the permission, and a gift
// is a stand-in, so it asks for a name and an amount and nothing about payment.

export type GiftState = { message: string } | null;

export async function give(
  token: string,
  _previous: GiftState,
  formData: FormData,
): Promise<GiftState> {
  if (!(await hit("gift", ipKey(await headers()))).ok)
    return { message: "Too many tries. Please wait a few minutes." };
  try {
    await giveGift(token, {
      giverName: String(formData.get("name") ?? ""),
      amountCents: Math.round(
        Number(String(formData.get("amount") ?? "").replace(/[$,]/g, "")) * 100,
      ),
    });
  } catch (error) {
    if (error instanceof FamilyError) return { message: error.message };
    throw error;
  }
  redirect(`/gift/${encodeURIComponent(token)}?thanks=1`);
}
