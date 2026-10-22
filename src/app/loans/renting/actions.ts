"use server";

import { redirect } from "next/navigation";
import { parseMoneyToCents } from "@/lib/money";
import { RentingError, markDepositReturned, saveDeposit, setRentReporting } from "@/lib/renting";
import { requireUser } from "@/lib/session";

// On /loans/renting (spec step 248): the person's own choices. Reporting starts only from the
// "turn on" button; a deposit is what they tell Jane.

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RentingError) {
      redirect(`/loans/renting?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/renting?${done}=1`);
}

export async function reportingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const on = String(formData.get("on") ?? "") === "yes";
  await step(() => setRentReporting(user.id, on), on ? "reporting_on" : "reporting_off");
}

export async function depositAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const amountCents = parseMoneyToCents(String(formData.get("amount") ?? "").trim());
  if (amountCents === null) {
    redirect(
      `/loans/renting?${new URLSearchParams({ error: "The deposit should be a dollar amount." })}`,
    );
  }
  const movedOut = String(formData.get("movedOutOn") ?? "").trim();
  await step(
    () =>
      saveDeposit(user.id, {
        amountCents,
        state: String(formData.get("state") ?? ""),
        movedOutOn: movedOut === "" ? null : movedOut,
      }),
    "deposit",
  );
}

export async function depositReturnedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const cents = parseMoneyToCents(String(formData.get("returned") ?? "0").trim() || "0");
  if (cents === null) {
    redirect(
      `/loans/renting?${new URLSearchParams({ error: "The amount returned should be a dollar amount." })}`,
    );
  }
  await step(
    () => markDepositReturned(user.id, String(formData.get("id") ?? ""), cents),
    "returned",
  );
}
