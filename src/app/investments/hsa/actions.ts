"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { HsaError, investHsaCash, linkDemoHsa, markReimbursed } from "@/lib/investments/hsa";
import { requireUser } from "@/lib/session";
import { ignoring } from "@/lib/ignoring";

// The HSA page's buttons (spec step 159).

const back = (done: string) => {
  revalidatePath("/investments");
  redirect(`/investments/hsa?done=${done}`);
};

export async function linkHsa(): Promise<void> {
  const user = await requireUser();
  await ignoring(HsaError, () => linkDemoHsa(user.id));
  back("linked");
}

export async function investHsa(): Promise<void> {
  const user = await requireUser();
  try {
    await investHsaCash(user.id);
  } catch (error) {
    if (!(error instanceof HsaError)) throw error;
    redirect("/investments/hsa");
  }
  back("invested");
}

export async function reimburse(formData: FormData): Promise<void> {
  const user = await requireUser();
  await ignoring(HsaError, () => markReimbursed(user.id, String(formData.get("receiptId") ?? "")));
  back("reimbursed");
}
