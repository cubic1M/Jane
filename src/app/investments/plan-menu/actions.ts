"use server";

import { redirect } from "next/navigation";
import {
  confirmMenu,
  PlanMenuError,
  proposeMenu,
  requestPlanChange,
  sampleDisclosure,
} from "@/lib/investments/plan-menu";
import { requireUser } from "@/lib/session";

// The plan menu page (spec step 232): read what the person pasted, confirm it, send a change.

const BASE = "/investments/plan-menu";
export type ReadState = { message: string } | null;

export async function readMenu(_previous: ReadState, formData: FormData): Promise<ReadState> {
  const user = await requireUser();
  try {
    await proposeMenu(user.id, String(formData.get("text") ?? ""), "you");
  } catch (error) {
    if (error instanceof PlanMenuError) return { message: error.message };
    throw error;
  }
  redirect(BASE);
}

export async function useSample(): Promise<void> {
  const user = await requireUser();
  try {
    await proposeMenu(user.id, sampleDisclosure(), "demo");
  } catch (error) {
    if (!(error instanceof PlanMenuError)) throw error;
  }
  redirect(BASE);
}

export async function confirm(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await confirmMenu(user.id, String(formData.get("id") ?? ""));
  } catch (error) {
    if (!(error instanceof PlanMenuError)) throw error;
  }
  redirect(`${BASE}?done=confirmed`);
}

export async function sendChange(): Promise<void> {
  const user = await requireUser();
  try {
    await requestPlanChange(user.id);
  } catch (error) {
    if (!(error instanceof PlanMenuError)) throw error;
    redirect(`${BASE}?done=changed`);
  }
  redirect(`${BASE}?done=requested`);
}
