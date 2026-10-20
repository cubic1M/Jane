"use server";

import { redirect } from "next/navigation";
import { CreditBuildingError, applyForBuilder, payBeforeStatement } from "@/lib/credit-building";
import { requireUser } from "@/lib/session";

// Building credit on /loans/credit (spec step 175): the payment before a card's statement
// closes, through the money-movement stand-in, and opening a credit-builder stand-in. Each
// only on the person's tap.

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CreditBuildingError) {
      redirect(`/loans/credit?${new URLSearchParams({ error: error.message })}#build`);
    }
    throw error;
  }
  redirect(`/loans/credit?done=${done}#build`);
}

export async function payStatementAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    () =>
      payBeforeStatement(user.id, {
        accountId: String(formData.get("accountId") ?? ""),
        closesOn: String(formData.get("closesOn") ?? ""),
      }),
    "paid",
  );
}

export async function openBuilderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => applyForBuilder(user.id, String(formData.get("productId") ?? "")), "opened");
}
