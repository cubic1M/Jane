"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { runAgentNow } from "@/lib/agent/run";
import { PLAN_OPTIONS } from "@/config/plan";
import { DecisionError, undoDecision } from "@/lib/decisions";
import { answerPlanItem, yesToAll } from "@/lib/plan";
import { ProposalError, acceptAllProposals, answerProposal } from "@/lib/proposals";
import { undoApproval, undoRuleApproval } from "@/lib/standing-rules";
import { PICK_UNDO_HOURS } from "@/config/rules";
import { requireUser } from "@/lib/session";
import type { ActionType } from "@/generated/prisma/client";

export type ItemState =
  | { kind: "approved"; changed: boolean; decisionId: string }
  | { kind: "declined"; decisionId: string }
  | { kind: "undone" }
  | { kind: "error"; message: string }
  | null;

const ID = /^[a-z0-9]{1,40}$/i;
const HASH = /^[0-9a-f]{64}$/;

// One plan item: Yes, No, or Yes with changed options.
export async function answerItem(_previous: ItemState, formData: FormData): Promise<ItemState> {
  const user = await requireUser();
  const findingId = String(formData.get("findingId") ?? "");
  const cardHash = String(formData.get("cardHash") ?? "");
  const choice = formData.get("choice");
  const actionType = String(formData.get("actionType") ?? "") as ActionType;
  if (!ID.test(findingId) || !HASH.test(cardHash) || (choice !== "yes" && choice !== "no")) {
    return { kind: "error", message: "Something went wrong. Reload the page and try again." };
  }
  const options =
    choice === "yes" && formData.get("changed") === "true" && actionType in PLAN_OPTIONS
      ? Object.fromEntries(
          PLAN_OPTIONS[actionType].map((o) => [o.key, formData.get(`option.${o.key}`)]),
        )
      : undefined;
  // No revalidate here: the item stays on screen showing its answer (and Undo) until the
  // page is next loaded.
  const result = await answerPlanItem(user.id, { findingId, cardHash, choice, options });
  if (result.ok) after(() => runAgentNow([result.agentJobId]));
  if (!result.ok) return { kind: "error", message: result.message };
  return choice === "yes"
    ? { kind: "approved", changed: options !== undefined, decisionId: result.decisionId }
    : { kind: "declined", decisionId: result.decisionId };
}

// Revert on a plan item (founder, 2026-10-25: "there should be a revert button"): a No is taken
// back within its undo window, a Yes while the work hasn't started (within PICK_UNDO_HOURS);
// either way the item is on the plan again.
export async function revertItem(decisionId: string, choice: "yes" | "no"): Promise<ItemState> {
  const user = await requireUser();
  if (!ID.test(decisionId) || (choice !== "yes" && choice !== "no")) {
    return { kind: "error", message: "Something went wrong. Reload the page and try again." };
  }
  try {
    if (choice === "no") await undoDecision(user.id, decisionId);
    else await undoApproval(user.id, decisionId, "plan", PICK_UNDO_HOURS);
  } catch (error) {
    if (!(error instanceof DecisionError)) throw error;
    return { kind: "error", message: error.message };
  }
  return { kind: "undone" };
}

// Takes back a No within the undo window.
export async function undoItem(_previous: ItemState, formData: FormData): Promise<ItemState> {
  const user = await requireUser();
  try {
    await undoDecision(user.id, String(formData.get("decisionId") ?? ""));
  } catch (error) {
    if (!(error instanceof DecisionError)) throw error;
    return { kind: "error", message: error.message };
  }
  return { kind: "undone" };
}

// "Yes to all": the items as shown, each checked against its card hash. Back to the plan
// with the counts, so the confirmation shows above whatever is left.
export async function answerAll(formData: FormData): Promise<void> {
  const user = await requireUser();
  const items = formData
    .getAll("item")
    .map((value) => String(value).split(":"))
    .filter(([id, hash]) => ID.test(id ?? "") && HASH.test(hash ?? ""))
    .map(([findingId, cardHash]) => ({ findingId, cardHash }));
  const results = await yesToAll(user.id, items);
  after(() => runAgentNow(results.map((r) => (r.ok ? r.agentJobId : undefined))));
  const approved = results.filter((r) => r.ok).length;
  redirect(
    `/plan?${new URLSearchParams({ approved: String(approved), skipped: String(results.length - approved) })}`,
  );
}

// Takes back an approval a standing rule made, within a day and before work starts.
export async function undoRule(_previous: ItemState, formData: FormData): Promise<ItemState> {
  const user = await requireUser();
  try {
    await undoRuleApproval(user.id, String(formData.get("decisionId") ?? ""));
  } catch (error) {
    if (!(error instanceof DecisionError)) throw error;
    return { kind: "error", message: error.message };
  }
  return { kind: "undone" };
}

export type ProposalState = { ok: boolean; message: string } | null;

// Yes, no, or yes with changes on a set-up proposal.
export async function answerSetup(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const user = await requireUser();
  const accept = formData.get("choice") === "yes";
  const text = (name: string) => String(formData.get(name) ?? "");
  try {
    await answerProposal(user.id, text("key"), accept, {
      amount: text("amount"),
      date: text("date"),
      detailed: text("detailed"),
    });
  } catch (error) {
    if (error instanceof ProposalError) return { ok: false, message: error.message };
    throw error;
  }
  return {
    ok: true,
    message: accept ? "Done. It's set up." : "Skipped. Jane won't suggest it again.",
  };
}

// "Use Jane's suggestions": every proposed budget and goal in one tap.
export async function acceptSuggestions(): Promise<ProposalState> {
  const user = await requireUser();
  const n = await acceptAllProposals(user.id);
  return { ok: true, message: `Set up ${n} ${n === 1 ? "suggestion" : "suggestions"}.` };
}
