"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SuddenKind } from "@/config/sudden-money";
import type { StageKey } from "@/planning/sudden-money";
import {
  addDemoDeposit,
  classify,
  doStage,
  SuddenMoneyError,
} from "@/lib/investments/sudden-money";
import { requireUser } from "@/lib/session";

// The sudden money page's buttons (spec step 235). Each stage is the person's tap.

const BASE = "/investments/sudden-money";

export async function answerKind(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await classify(
      user.id,
      String(formData.get("id") ?? ""),
      String(formData.get("kind") ?? "") as SuddenKind | "transfer",
    );
  } catch (error) {
    if (!(error instanceof SuddenMoneyError)) throw error;
  }
  redirect(BASE);
}

export async function stage(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await doStage(
      user.id,
      String(formData.get("id") ?? ""),
      String(formData.get("stage") ?? "") as StageKey,
    );
  } catch (error) {
    if (!(error instanceof SuddenMoneyError)) throw error;
    redirect(`${BASE}?done=changed`);
  }
  revalidatePath("/investments");
  redirect(`${BASE}?done=moved`);
}

export async function demoDeposit(): Promise<void> {
  const user = await requireUser();
  try {
    await addDemoDeposit(user.id);
  } catch (error) {
    if (!(error instanceof SuddenMoneyError)) throw error;
  }
  redirect(BASE);
}
