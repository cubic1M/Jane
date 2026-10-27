import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { cancelTransfer, scheduleTransfer } from "@/lib/money-movement/transfers";
import { postMessages } from "../messages";
import type { MultiResult, MultiStep } from "../types";
import { ChatActionError, linksOf, type ActionContext, type ActionHandler } from "./handler";
import { takeChatAction } from "./index";
import { dayLabel } from "@/lib/day-label";

// Spec step 185: a plan of several steps (../multi.ts), confirmed once. The steps run in
// order, each through its feature's own code: a feature's Yes on its own (hidden) message,
// through takeChatAction, so every check and effect is the same as tapping it there; a
// transfer through the money-movement partner. The first that fails stops the rest and
// says why. Transfers can be undone while they're pending.

async function runStep(
  { userId, message, client, now }: ActionContext,
  step: MultiStep,
  n: number,
): Promise<MultiResult> {
  if (step.kind === "transfer") {
    const { id, runOn } = await scheduleTransfer(
      userId,
      {
        fromAccountId: step.fromAccountId,
        toAccountId: step.toAccountId,
        toName: step.goalName,
        amountCents: step.amountCents,
        purpose: "goal",
        sector: "goals",
        goalId: step.goalId,
        planKey: `chat:${message.id}`,
      },
      "person",
      { client, now },
    );
    return {
      status: "done",
      note: `${formatCents(step.amountCents)} goes to ${step.goalName} on ${dayLabel(runOn)}; you can undo it until then.`,
      transferId: id,
    };
  }
  // The feature's own message for this step, hidden behind the plan, then its own button.
  const dedupeKey = `multi:${message.id}:${n}`;
  await postMessages(
    userId,
    [
      {
        kind: "decision",
        body: step.body,
        refs: step.refs,
        actions: step.actions,
        dedupeKey,
        priority: 0,
        source: "multi",
        hidden: true,
      },
    ],
    { client, now },
  );
  const row = await scopedFor(userId, client).janeMessages.findFirst({
    where: { dedupeKey },
    select: { id: true },
  });
  if (!row) throw new ChatActionError("failed", "That step couldn't start.");
  const { message: answered } = await takeChatAction(userId, row.id, step.action, {
    client,
    now,
    ...(step.choice ? { choice: step.choice } : {}),
  });
  return { status: "done", note: answered.refs.note ?? "Done." };
}

export const multiConfirm: ActionHandler = {
  id: "multi.confirm",
  on: "open",
  async run(context) {
    const steps = context.message.refs.multi?.steps ?? [];
    if (steps.length === 0)
      throw new ChatActionError("failed", "There's nothing in this plan. Ask again.");
    const results: MultiResult[] = [];
    for (const [i, step] of steps.entries()) {
      if (results.some((r) => r.status === "failed")) {
        results.push({ status: "not_done", note: "Not done, because the step before it failed." });
        continue;
      }
      try {
        results.push(await runStep(context, step, i + 1));
      } catch (error) {
        const why = error instanceof Error ? error.message : "Something went wrong.";
        results.push({ status: "failed", note: `Didn't happen: ${why}` });
      }
    }
    const failed = results.findIndex((r) => r.status === "failed");
    const lines = results.map(
      (r, i) =>
        `${i + 1}. ${r.status === "done" && !/^done\b/i.test(r.note) ? "Done. " : ""}${r.note}`,
    );
    const head =
      failed < 0
        ? "All done, in order."
        : failed === 0
          ? "I stopped at the first step, so nothing changed."
          : `I stopped at step ${failed + 1}; the steps before it are done.`;
    const undo = results.some((r) => r.transferId)
      ? [{ id: "multi.undo" as const, label: "Undo the transfer", kind: "secondary" as const }]
      : [];
    return {
      answeredWith: context.action.label,
      note: [head, ...lines].join("\n"),
      refs: { ...context.message.refs, multi: { steps, results } },
      actions: [...undo, ...linksOf(context.message.actions)],
    };
  },
};

export const multiCancel: ActionHandler = {
  id: "multi.cancel",
  on: "open",
  async run({ message, action }) {
    return {
      answeredWith: action.label,
      note: "Nothing done.",
      actions: linksOf(message.actions),
    };
  },
};

// Undo what the plan moved, while it's still pending.
export const multiUndo: ActionHandler = {
  id: "multi.undo",
  on: "answered",
  async run({ userId, message, client, now }) {
    const results = message.refs.multi?.results ?? [];
    const ids = results.flatMap((r) => (r.transferId ? [r.transferId] : []));
    let note = "Undone: the transfer won't happen.";
    try {
      for (const id of ids) await cancelTransfer(userId, id, { client, now });
    } catch (error) {
      throw new ChatActionError(
        "expired",
        error instanceof Error ? error.message : "That can't be undone anymore.",
      );
    }
    if (ids.length > 1) note = "Undone: those transfers won't happen.";
    return {
      status: "answered",
      answeredWith: message.answeredWith,
      note,
      actions: linksOf(message.actions),
    };
  },
};
