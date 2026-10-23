"use server";

import { redirect } from "next/navigation";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { PRACTICE_SETTINGS_HREF } from "@/config/practice-suggestions";
import { runAutopilot, setPaused, undoLastTrade } from "@/lib/practice/autopilot";
import { answerIdeaHere } from "@/lib/practice/ideas-view";
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

// Yes or No on one of Jane's practice ideas, from the page (Phase AW): the same answer as the
// chat's, so it moves what Jane brings next.
export async function answerIdea(formData: FormData): Promise<void> {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  const answer = formData.get("answer") === "yes" ? "yes" : "no";
  const out = await answerIdeaHere(user.id, key, answer);
  if (!out) back("idea_gone");
  if (answer === "no") back("idea_no");
  if (out!.href === PRACTICE_SETTINGS_HREF) redirect(PRACTICE_SETTINGS_HREF);
  back(
    out!.note.startsWith("Done")
      ? "idea_done"
      : out!.note.startsWith("A cap")
        ? "idea_held"
        : out!.note.includes("paused")
          ? "idea_paused"
          : "idea_gone",
  );
}
