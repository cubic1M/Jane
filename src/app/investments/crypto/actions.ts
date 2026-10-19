"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CryptoError, linkDemoCrypto, syncCrypto } from "@/lib/crypto/crypto";
import { requireUser } from "@/lib/session";

// The crypto page's buttons (spec step 161): connect a demo exchange or wallet, read-only,
// and read the balances again. Nothing here, or anywhere, trades crypto.

export async function linkCrypto(formData: FormData): Promise<void> {
  const user = await requireUser();
  const kind = formData.get("kind") === "wallet" ? "wallet" : "exchange";
  try {
    await linkDemoCrypto(user.id, kind);
  } catch (error) {
    if (!(error instanceof CryptoError)) throw error;
  }
  revalidatePath("/net-worth");
  redirect("/investments/crypto?done=linked");
}

export async function refreshCrypto(): Promise<void> {
  const user = await requireUser();
  await syncCrypto(user.id);
  redirect("/investments/crypto?done=refreshed");
}
