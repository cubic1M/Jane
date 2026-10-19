"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LIFE_HEALTH_QUESTIONS, type LifeQuestionKey } from "@/config/insurance";
import {
  LifeError,
  answerLifeQuestion,
  buyLife,
  dismissLife,
  saveDependants,
  sizeLife,
  startLifeApplication,
  submitLifeApplication,
} from "@/lib/insurance/life";
import { requireUser } from "@/lib/session";

// The life cover page (spec step 153). Each is one tap; each goes back to /insurance/life,
// refreshed, with what went wrong (an expired quote or offer) in ?error=.

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

async function done(run: () => Promise<unknown>, after = "/insurance/life"): Promise<never> {
  let error: string | null = null;
  try {
    await run();
  } catch (e) {
    if (!(e instanceof LifeError)) throw e;
    error = e.message;
  }
  revalidatePath("/insurance/life");
  revalidatePath("/chat");
  redirect(error ? `/insurance/life?error=${encodeURIComponent(error)}` : after);
}

export async function setDependants(formData: FormData): Promise<void> {
  const user = await requireUser();
  const n = Number(text(formData, "dependants"));
  await done(async () => {
    if (!Number.isInteger(n) || n < 0 || n > 3) throw new LifeError("Pick how many.");
    await saveDependants(user.id, n);
    await sizeLife(user.id, { asked: true });
  });
}

export async function apply(formData: FormData): Promise<void> {
  const user = await requireUser();
  await done(() =>
    startLifeApplication(user.id, text(formData, "applicationId"), text(formData, "quoteId")),
  );
}

export async function answer(formData: FormData): Promise<void> {
  const user = await requireUser();
  const key = text(formData, "question");
  await done(async () => {
    if (!LIFE_HEALTH_QUESTIONS.some((q) => q.key === key)) throw new LifeError("Pick an answer.");
    await answerLifeQuestion(
      user.id,
      text(formData, "applicationId"),
      key as LifeQuestionKey,
      text(formData, "answer") === "yes",
    );
  });
}

export async function submit(formData: FormData): Promise<void> {
  const user = await requireUser();
  await done(() => submitLifeApplication(user.id, text(formData, "applicationId")));
}

export async function buy(formData: FormData): Promise<void> {
  const user = await requireUser();
  await done(() => buyLife(user.id, text(formData, "applicationId")), "/insurance?saved=added");
}

export async function notNow(formData: FormData): Promise<void> {
  const user = await requireUser();
  await done(() => dismissLife(user.id, text(formData, "applicationId")), "/insurance");
}
