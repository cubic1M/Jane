import type { Prisma } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import type { Reply } from "../replies";
import { parseActions, parseRefs } from "../types";
import { typedAnswer, type FlowContext, type FlowId, type FlowState } from "./engine";
import { FLOWS } from "./index";
import { answerFlow, showFlow, startFlow } from "./run";

// Guided flows in the typed chat (spec step 95): starting one, picking an open one up again
// (by asking for it again, or "continue"), and typed answers to a question that takes one.

type Open = { id: string; state: FlowState };

// The newest flow question still waiting, of one flow or any.
async function openFlow({ userId, client }: FlowContext, id?: FlowId): Promise<Open | null> {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: { kind: "reply", status: "open" },
    orderBy: { createdAt: "desc" },
    select: { id: true, refs: true },
    take: 50,
  });
  for (const row of rows) {
    const state = parseRefs(row.refs).flow;
    if (state && FLOWS[state.id] && (!id || state.id === id)) return { id: row.id, state };
  }
  return null;
}

// The old question gives way to the new one below it.
async function setAside(context: FlowContext, messageId: string, answeredWith: string | null) {
  const db = scopedFor(context.userId, context.client);
  const row = await db.janeMessages.findFirst({
    where: { id: messageId },
    select: { actions: true },
  });
  await db.janeMessages.updateMany({
    where: { id: messageId, status: "open" },
    data: {
      status: answeredWith ? "answered" : "dismissed",
      answeredWith,
      answeredAt: context.now,
      actions: parseActions(row?.actions).filter((a) => a.kind === "link") as Prisma.InputJsonArray,
    },
  });
}

// "Set up a budget": the first question, or the open one picked up where it was.
export async function flowReply(flow: FlowId | "resume", context: FlowContext): Promise<Reply> {
  const open = await openFlow(context, flow === "resume" ? undefined : flow);
  if (!open) {
    if (flow === "resume") {
      return { body: "There's nothing to pick up right now.", actions: [], refs: {} };
    }
    return startFlow(flow, context);
  }
  await setAside(context, open.id, null);
  const step = await showFlow(open.state, context);
  return { ...step, body: `Let's pick up where we left off. ${step.body}` };
}

// A typed answer to the question just asked, when it takes one; null when the text isn't
// an answer to it (then it's read as a question of its own).
export async function typedFlowReply(text: string, context: FlowContext): Promise<Reply | null> {
  const newest = await scopedFor(context.userId, context.client).janeMessages.findFirst({
    where: { kind: "reply" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, refs: true },
  });
  const state = newest?.status === "open" ? parseRefs(newest.refs).flow : undefined;
  if (!newest || !state?.typed || !FLOWS[state.id]) return null;
  const value = typedAnswer(state.typed, text);
  if (value === null) return null;
  const move = await answerFlow(state, value, context);
  await setAside(context, newest.id, text.trim());
  return move.done
    ? { body: move.note, actions: [], refs: {} }
    : { body: move.body, actions: move.actions, refs: move.refs };
}
