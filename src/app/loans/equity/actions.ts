"use server";

import { redirect } from "next/navigation";
import { HomeEquityError, markHomeRequestSent, saveHomeFacts } from "@/lib/home-equity";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// On /loans/equity (spec step 228): what the person tells Jane about their home loan, and
// that they sent a drafted request to their servicer.

const money = (value: FormDataEntryValue | null, label: string): number | null => {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const cents = parseMoneyToCents(raw);
  if (cents === null) throw new HomeEquityError(`${label} should be a dollar amount.`);
  return cents;
};

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HomeEquityError) {
      redirect(`/loans/equity?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/equity?${done}=1`);
}

export async function saveFactsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    async () =>
      saveHomeFacts(user.id, {
        originalValueCents: money(formData.get("originalValue"), "The home's original value"),
        yearlyTaxCents: money(formData.get("yearlyTax"), "The property tax"),
        yearlyInsuranceCents: money(formData.get("yearlyInsurance"), "The insurance"),
      }),
    "saved",
  );
}

export async function requestSentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const which = String(formData.get("which") ?? "");
  if (which !== "pmi" && which !== "escrow") redirect("/loans/equity");
  await step(() => markHomeRequestSent(user.id, which), "sent");
}
