"use server";

import { redirect } from "next/navigation";
import {
  FamilyCreditError,
  addFamilyCredit,
  removeFamilyCredit,
  setMissed,
} from "@/lib/family-credit";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// On /loans/helping (spec step 249): what the person tells Jane about credit they give through
// someone close. Nothing is applied for or sent to anyone.

const BACK = "/loans/helping";

const money = (value: FormDataEntryValue | null, label: string): number | null => {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const cents = parseMoneyToCents(raw);
  if (cents === null) throw new FamilyCreditError(`${label} should be a dollar amount.`);
  return cents;
};

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FamilyCreditError) {
      redirect(`${BACK}?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`${BACK}?${done}=1`);
}

export async function addAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    async () =>
      addFamilyCredit(user.id, {
        kind: String(formData.get("kind") ?? ""),
        person: String(formData.get("person") ?? ""),
        debtKey: String(formData.get("debtKey") ?? "") || null,
        balanceCents: money(formData.get("balance"), "What's owed"),
        monthlyPaymentCents: money(formData.get("payment"), "The payment"),
      }),
    "added",
  );
}

export async function missedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const missed = String(formData.get("missed") ?? "") === "yes";
  await step(() => setMissed(user.id, String(formData.get("id") ?? ""), missed), "updated");
}

export async function removeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => removeFamilyCredit(user.id, String(formData.get("id") ?? "")), "removed");
}
