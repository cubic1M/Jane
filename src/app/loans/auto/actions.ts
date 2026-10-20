"use server";

import { redirect } from "next/navigation";
import {
  CarLoanError,
  addTypedAddon,
  confirmAddon,
  dismissAddon,
  requestCancellation,
} from "@/lib/car-loan";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// On /loans/auto (spec step 245): say what a payment was, add an add-on by hand, and choose who
// sends the cancellation. Nothing is sent from here.

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CarLoanError) {
      redirect(`/loans/auto?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/auto?${done}=1`);
}

export async function confirmAddonAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const term = Number(String(formData.get("termMonths") ?? "").trim());
  await step(
    () =>
      confirmAddon(user.id, String(formData.get("key") ?? ""), {
        termMonths: Number.isFinite(term) && term > 0 ? term : undefined,
      }),
    "confirmed",
  );
}

export async function dismissAddonAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => dismissAddon(user.id, String(formData.get("key") ?? "")), "dismissed");
}

export async function addAddonAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const paid = parseMoneyToCents(String(formData.get("paid") ?? ""));
  await step(async () => {
    if (paid === null) throw new CarLoanError("The price should be a dollar amount.");
    await addTypedAddon(user.id, {
      kind: String(formData.get("kind") ?? ""),
      name: String(formData.get("name") ?? ""),
      paidCents: paid,
      termMonths: Number(String(formData.get("termMonths") ?? "")),
      startedOn: String(formData.get("startedOn") ?? ""),
    });
  }, "added");
}

export async function cancelAddonAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const by = String(formData.get("by") ?? "");
  if (by !== "mine" && by !== "team") redirect("/loans/auto");
  await step(() => requestCancellation(user.id, String(formData.get("id") ?? ""), by), "requested");
}
