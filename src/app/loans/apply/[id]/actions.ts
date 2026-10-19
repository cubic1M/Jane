"use server";

import { redirect } from "next/navigation";
import {
  LoanApplicationError,
  acceptLoan,
  submitApplication,
  withdrawApplication,
} from "@/lib/loan-applications";
import { requireUser } from "@/lib/session";

// The application's review screen (spec step 112): submit once the terms are reviewed
// (the box must be ticked), accept the approved loan, or withdraw. Each back to the page.

const back = (id: string, params: Record<string, string>) =>
  `/loans/apply/${encodeURIComponent(id)}?${new URLSearchParams(params)}`;

async function run(id: string, done: string, step: () => Promise<unknown>): Promise<never> {
  try {
    await step();
  } catch (error) {
    if (error instanceof LoanApplicationError) redirect(back(id, { error: error.message }));
    throw error;
  }
  redirect(back(id, { done }));
}

export async function submitAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  await run(id, "submitted", () =>
    submitApplication(user.id, id, { reviewed: formData.get("reviewed") === "on" }),
  );
}

export async function acceptAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  await run(id, "accepted", () => acceptLoan(user.id, id));
}

export async function withdrawAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  await run(id, "withdrawn", () => withdrawApplication(user.id, id));
}
