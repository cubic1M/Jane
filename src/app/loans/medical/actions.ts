"use server";

import { redirect } from "next/navigation";
import { MedicalBillError, addMedicalBill, sendMedicalItem } from "@/lib/medical-bills";
import { requireUser } from "@/lib/session";

// Medical bills on /loans/medical (spec step 180): add a bill, and send one prepared
// request, only on the person's tap.

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof MedicalBillError) {
      redirect(`/loans/medical?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/medical?${done}=1`);
}

export async function addBillAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    () =>
      addMedicalBill(user.id, {
        provider: String(formData.get("provider") ?? ""),
        amount: String(formData.get("amount") ?? ""),
        billedOn: String(formData.get("billedOn") ?? ""),
      }),
    "added",
  );
}

export async function sendRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => sendMedicalItem(user.id, String(formData.get("itemId") ?? "")), "sent");
}
