"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BenefitError,
  answerQuestion,
  confirmBenefit,
  declineBenefit,
  type BenefitAnswer,
  type BenefitQuestion,
} from "@/lib/insurance/benefits";
import { reviewBenefitsNow } from "@/lib/insurance/benefits-review";
import { requireUser } from "@/lib/session";

// The benefits page (spec step 150). Each goes back to /insurance/benefits, refreshed.

const QUESTIONS: readonly BenefitQuestion[] = ["life", "disability"];
const ANSWERS: readonly BenefitAnswer[] = ["1x", "2x", "yes", "none", "unsure"];
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

async function done(run: () => Promise<unknown>): Promise<never> {
  try {
    await run();
  } catch (error) {
    // Already answered elsewhere: the page shows it as it is.
    if (!(error instanceof BenefitError)) throw error;
  }
  revalidatePath("/insurance/benefits");
  redirect("/insurance/benefits");
}

export async function confirm(formData: FormData): Promise<void> {
  const user = await requireUser();
  await done(() => confirmBenefit(user.id, text(formData, "benefitId")));
}

export async function notThis(formData: FormData): Promise<void> {
  const user = await requireUser();
  await done(() => declineBenefit(user.id, text(formData, "benefitId")));
}

export async function answer(formData: FormData): Promise<void> {
  const user = await requireUser();
  const question = text(formData, "question") as BenefitQuestion;
  const value = text(formData, "answer") as BenefitAnswer;
  if (!QUESTIONS.includes(question) || !ANSWERS.includes(value)) redirect("/insurance/benefits");
  await done(() => answerQuestion(user.id, question, value));
}

export async function compareNow(): Promise<void> {
  const user = await requireUser();
  await done(() => reviewBenefitsNow(user.id));
}
