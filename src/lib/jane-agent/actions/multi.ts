import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { TransferError, cancelTransfer, scheduleTransfer } from "@/lib/money-movement/transfers";
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

// A step's result, and the background work it queued (a switch's agent job) for the caller to run.
type Step = MultiResult & { agentJobIds: (string | undefined)[]; agentActionIds: string[] };

async function runStep(
  { userId, message, client, now }: ActionContext,
  step: MultiStep,
  n: number,
): Promise<Step> {
  if (step.kind === "transfer") {
    const { id, runOn, awaitingPartner } = await scheduleTransfer(
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
    // A big move out of a shared account has not gone to the partner yet: it waits for the other
    // person's tap, and Undo cancels the request.
    const note = awaitingPartner
      ? `${formatCents(step.amountCents)} to ${step.goalName} waits for your partner's OK before it is scheduled; you can undo the request until then.`
      : `${formatCents(step.amountCents)} goes to ${step.goalName} on ${dayLabel(runOn)}; you can undo it until then.`;
    return { status: "done", note, transferId: id, agentJobIds: [], agentActionIds: [] };
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
  const taken = await takeChatAction(userId, row.id, step.action, {
    client,
    now,
    ...(step.choice ? { choice: step.choice } : {}),
  });
  return {
    status: "done",
    note: taken.message.refs.note ?? "Done.",
    agentJobIds: taken.agentJobIds,
    agentActionIds: taken.agentActionIds,
  };
}

export const multiConfirm: ActionHandler = {
  id: "multi.confirm",
  on: "open",
  async run(context) {
    const steps = context.message.refs.multi?.steps ?? [];
    if (steps.length === 0)
      throw new ChatActionError("failed", "There's nothing in this plan. Ask again.");
    const results: MultiResult[] = [];
    const agentJobIds: (string | undefined)[] = [];
    const agentActionIds: string[] = [];
    for (const [i, step] of steps.entries()) {
      if (results.some((r) => r.status === "failed")) {
        results.push({ status: "not_done", note: "Not done, because the step before it failed." });
        continue;
      }
      try {
        const {
          agentJobIds: jobs,
          agentActionIds: actions,
          ...result
        } = await runStep(context, step, i + 1);
        results.push(result);
        agentJobIds.push(...jobs);
        agentActionIds.push(...actions);
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
      agentJobIds,
      agentActionIds,
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

// Undo what the plan moved, while it's still pending. Each transfer is tried: one that has gone
// through stays (and is said), one that could not be reached keeps the button for another try.
export const multiUndo: ActionHandler = {
  id: "multi.undo",
  on: "answered",
  async run({ userId, message, client, now }) {
    const results = message.refs.multi?.results ?? [];
    const ids = results.flatMap((r) => (r.transferId ? [r.transferId] : []));
    const cancelled = new Set<string>();
    const gone = new Set<string>();
    const retry = new Set<string>();
    let why: string | null = null;
    for (const id of ids) {
      try {
        await cancelTransfer(userId, id, { client, now });
        cancelled.add(id);
      } catch (error) {
        if (why === null && error instanceof Error) why = error.message;
        if (error instanceof TransferError) gone.add(id);
        else retry.add(id);
      }
    }
    if (cancelled.size === 0)
      throw new ChatActionError("expired", why ?? "That can't be undone anymore.");
    const parts = [
      cancelled.size > 1
        ? "Undone: those transfers won't happen."
        : "Undone: the transfer won't happen.",
    ];
    if (gone.size > 0)
      parts.push(
        gone.size > 1
          ? "Others had already gone through, so they stay."
          : "The other one had already gone through, so it stays.",
      );
    if (retry.size > 0) parts.push("One couldn't be reached just now; tap Undo again to retry it.");
    // A transfer that is cancelled, or too late to cancel, is not offered again.
    const settled = results.map((r) =>
      r.transferId && !retry.has(r.transferId) ? { ...r, transferId: undefined } : r,
    );
    return {
      status: "answered",
      answeredWith: message.answeredWith,
      note: parts.join(" "),
      refs: {
        ...message.refs,
        multi: { steps: message.refs.multi?.steps ?? [], results: settled },
      },
      actions: [
        ...(retry.size > 0
          ? [{ id: "multi.undo" as const, label: "Undo the transfer", kind: "secondary" as const }]
          : []),
        ...linksOf(message.actions),
      ],
    };
  },
};
