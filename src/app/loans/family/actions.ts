"use server";

import { redirect } from "next/navigation";
import {
  FamilyLoanError,
  addCosignedLoan,
  confirmFamilyLoan,
  dismissFamilyLoan,
  settleFamilyLoan,
} from "@/lib/family-loans";
import { requireUser } from "@/lib/session";

// On /loans/family (spec step 226): say whether a transfer was a loan, settle one by hand,
// and mark a loan you co-signed. Jane never contacts the other person.

async function step(run: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FamilyLoanError) {
      redirect(`/loans/family?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect(`/loans/family?${done}=1`);
}

export async function confirmLoanAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    () => confirmFamilyLoan(user.id, String(formData.get("candidateId") ?? "")),
    "confirmed",
  );
}

export async function dismissLoanAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    () => dismissFamilyLoan(user.id, String(formData.get("candidateId") ?? "")),
    "dismissed",
  );
}

export async function settleLoanAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(() => settleFamilyLoan(user.id, String(formData.get("loanId") ?? "")), "settled");
}

export async function addCosignedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await step(
    () =>
      addCosignedLoan(user.id, {
        debtKey: String(formData.get("debtKey") ?? ""),
        counterparty: String(formData.get("counterparty") ?? ""),
      }),
    "cosigned",
  );
}
