"use server";

import { redirect } from "next/navigation";
import {
  CardInterestError,
  addCardPromo,
  removeCardPromo,
  sendRateRequest,
} from "@/lib/card-interest";
import { requireUser } from "@/lib/session";

// On /loans/interest (spec step 224): add or remove a 0% promotion, and send one card's
// request for a lower rate, only on the person's tap.

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CardInterestError) {
      redirect(`/loans/interest?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/interest?${done}=1`);
}

export async function addPromoAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const text = (k: string) => String(formData.get(k) ?? "");
  await step(
    () =>
      addCardPromo(user.id, {
        cardName: text("cardName"),
        balance: text("balance"),
        startedOn: text("startedOn"),
        endsOn: text("endsOn"),
        goToApr: text("goToApr"),
        deferred: formData.get("deferred") === "on",
      }),
    "added",
  );
}

export async function removePromoAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => removeCardPromo(user.id, String(formData.get("promoId") ?? "")), "removed");
}

export async function sendRateAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => sendRateRequest(user.id, String(formData.get("requestId") ?? "")), "sent");
}
