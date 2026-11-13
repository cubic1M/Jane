"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CryptoError, linkDemoCrypto, syncCrypto } from "@/lib/crypto/crypto";
import { requireUser } from "@/lib/session";
import { ignoring } from "@/lib/ignoring";

// The crypto page's buttons (spec step 161): connect a demo exchange or wallet, read-only,
// and read the balances again. Nothing here, or anywhere, trades crypto.

export async function linkCrypto(formData: FormData): Promise<void> {
  const user = await requireUser();
  const kind = formData.get("kind") === "wallet" ? "wallet" : "exchange";
  await ignoring(CryptoError, () => linkDemoCrypto(user.id, kind));
  revalidatePath("/net-worth");
  redirect("/investments/crypto?done=linked");
}

export async function refreshCrypto(): Promise<void> {
  const user = await requireUser();
  await syncCrypto(user.id);
  redirect("/investments/crypto?done=refreshed");
}
