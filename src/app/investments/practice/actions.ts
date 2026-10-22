"use server";

import { redirect } from "next/navigation";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { runAutopilot, setPaused, undoLastTrade } from "@/lib/practice/autopilot";
import { PracticeError, startPractice } from "@/lib/practice/portfolio";
import { requireUser } from "@/lib/session";

// The practice portfolio page's buttons (spec steps 291 and 294). Practice money only.

const back = (done: string) => redirect(`/investments/practice?done=${done}`);

export async function startPracticePortfolio(formData: FormData): Promise<void> {
  const user = await requireUser();
  const level = Number(formData.get("level"));
  if (!Object.hasOwn(RISK_LEVELS, level)) back("level");
  try {
    await startPractice(user.id, level as RiskLevel);
    await runAutopilot(user.id);
  } catch (error) {
    if (!(error instanceof PracticeError)) throw error;
    back("exists");
  }
  back("started");
}

export async function runNow(): Promise<void> {
  const user = await requireUser();
  await runAutopilot(user.id);
  back("ran");
}

export async function pauseSwitch(formData: FormData): Promise<void> {
  const user = await requireUser();
  const which = formData.get("which") === "opportunities" ? "opportunities" : "all";
  await setPaused(user.id, which, formData.get("paused") === "1");
  back(formData.get("paused") === "1" ? "paused" : "resumed");
}

export async function undoLast(): Promise<void> {
  const user = await requireUser();
  try {
    await undoLastTrade(user.id);
  } catch (error) {
    if (!(error instanceof PracticeError)) throw error;
    back("nothing");
  }
  back("undone");
}
