"use server";

import { revalidatePath } from "next/cache";
import {
  PaperError,
  revertTrade,
  skipSignal,
  startPaperAccount,
  takeSignal,
  type TakeResult,
} from "@/lib/paper/account";
import { requireUser } from "@/lib/session";

// The paper account's buttons: start it, and the trade pop-up's Paper trade it, Skip and Revert.
// Each answers with what happened; the page has already shown it. Simulated only.

export type StartResult = { ok: true } | { ok: false; error: string };

export async function startPaperAction(dollars: string): Promise<StartResult> {
  const user = await requireUser();
  const cents = Math.round(Number(String(dollars).replace(/[$,\s]/g, "")) * 100);
  try {
    await startPaperAccount(user.id, Number.isFinite(cents) ? cents : NaN);
  } catch (error) {
    if (error instanceof PaperError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath("/investments");
  return { ok: true };
}

export async function paperTakeAction(signalId: string): Promise<TakeResult> {
  const user = await requireUser();
  const result = await takeSignal(user.id, signalId);
  if (result.ok) revalidatePath("/investments");
  return result;
}

export async function paperSkipAction(signalId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  return skipSignal(user.id, signalId);
}

export async function paperRevertAction(
  tradeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const result = await revertTrade(user.id, tradeId);
  if (result.ok) revalidatePath("/investments");
  return result;
}
