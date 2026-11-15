import { isSampleTrialUser } from "@/lib/trial-ids";
import { log } from "@/lib/log";
import { AGENT_MAX_BODY } from "@/config/agent";
import type { ActionStatus, PrismaClient } from "@/generated/prisma/client";
import { sendStatusEmail, statusEmail } from "@/lib/action-emails";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { FINDING_STATUS } from "@/lib/action-status";
import { scopedFor } from "@/lib/db-scoped";
import { PLACEHOLDERS } from "@/lib/drafts";
import { holderName } from "@/lib/holder-name";
import type { sendAgentMail } from "./mail";
import type { readReply, ReplyReading } from "./read-reply";

// An agent action as the agent's steps see it: loading it, what it may do, and writing what
// happened (its status, a hand-off to the team, the timeline). Kept apart from the agent's run
// (run.ts) so the switches and calls that use these don't import the run that starts them.

export type Options = {
  client?: PrismaClient;
  now?: Date;
  send?: typeof sendAgentMail;
  read?: typeof readReply;
  notify?: typeof sendStatusEmail;
};

// Statuses the agent may work in: approved and not finished.
const WORKABLE: readonly ActionStatus[] = ["queued", "in_progress", "waiting_on_user"];

export async function loadAction(userId: string, actionId: string, client: PrismaClient) {
  const action = await scopedFor(userId, client).actions.findFirst({
    where: { id: actionId },
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      agentState: true,
      agentFollowUps: true,
      agentNextAt: true,
      replyToken: true,
      decision: {
        select: {
          choice: true,
          undoneAt: true,
          findingId: true,
          cardSnapshot: true,
          options: true,
          source: true,
          finding: { select: { type: true, evidence: true } },
        },
      },
      user: { select: { email: true, name: true, acceptSimpleOffers: true } },
      cancelledOn: true,
      agentMessages: {
        where: { direction: "outbound" },
        orderBy: { createdAt: "asc" },
        select: { toAddress: true, subject: true, body: true },
      },
    },
  });
  if (!action) return null;
  return { ...action, company: await companyOf(userId, action.decision.finding.evidence, client) };
}

// Who the request goes to: the merchant on the finding, or for bank fees the bank that
// holds the account (known for linked banks; a file import doesn't say).
async function companyOf(
  userId: string,
  evidence: unknown,
  client: PrismaClient,
): Promise<string | null> {
  const facts = (evidence ?? {}) as { merchant?: unknown; accountId?: unknown };
  if (typeof facts.merchant === "string" && facts.merchant.trim()) return facts.merchant;
  if (typeof facts.accountId !== "string") return null;
  const account = await scopedFor(userId, client).accounts.findFirst({
    where: { id: facts.accountId },
    select: { item: { select: { institutionName: true } } },
  });
  return account?.item?.institutionName ?? null;
}

export type LoadedAction = NonNullable<Awaited<ReturnType<typeof loadAction>>>;

// The agent may only touch an approved action that isn't finished.
export function canAgentWork(action: {
  status: ActionStatus;
  agentState: string | null;
  decision: { choice: string; undoneAt: Date | null };
}): boolean {
  return (
    action.decision.choice === "yes" &&
    action.decision.undoneAt === null &&
    WORKABLE.includes(action.status) &&
    (action.agentState === "working" || action.agentState === "waiting_reply")
  );
}

export const merchantOf = (action: LoadedAction) => action.company ?? "the company";

const titleOf = (action: LoadedAction) => {
  const title = (action.decision.cardSnapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "Your request";
};

export async function setStatus(
  userId: string,
  action: LoadedAction,
  status: ActionStatus,
  data: Record<string, unknown>,
  { client, now, notify }: Required<Pick<Options, "client" | "now" | "notify">>,
) {
  const db = scopedFor(userId, client);
  const closing = status === "done" || status === "failed";
  await db.actions.updateMany({
    where: { id: action.id },
    data: {
      status,
      startedAt: action.startedAt ?? (status === "queued" ? null : now),
      completedAt: closing ? now : null,
      ...data,
    },
  });
  await db.findings.updateMany({
    where: { id: action.decision.findingId },
    data: { status: FINDING_STATUS[status] },
  });
  if (status !== action.status) {
    const userTodo = typeof data.userTodo === "string" ? data.userTodo : null;
    const email = statusEmail(status, titleOf(action), userTodo);
    if (email && action.user.email) {
      await notify(action.user.email, email).catch((error) =>
        log.error("Agent status email failed", { actionId: action.id, error: String(error) }),
      );
    }
  }
}

// Passes the action to the team with the reason, back in the queue.
export async function handOff(
  userId: string,
  action: LoadedAction,
  reason: string,
  options: Required<Pick<Options, "client" | "now" | "notify">>,
) {
  await scopedFor(userId, options.client).actions.updateMany({
    where: { id: action.id },
    data: { agentState: "handed_off", handoffReason: reason, agentNextAt: null, status: "queued" },
  });
  // Spec step 138: the team never works a sample person's request, so it isn't promised.
  await note(
    userId,
    action.id,
    isSampleTrialUser(userId)
      ? `This is as far as Jane goes with sample data: ${reason} With your own account, our team would take it from here.`
      : `Passed to our team: ${reason}`,
    options.client,
  );
  await logAudit(
    SYSTEM_ACTOR,
    "agent_handed_off",
    { type: "action", id: action.id },
    { reason, user_id: userId },
  );
  await track(userId, "agent_handed_off", { action_type: action.type });
}

// The person's name and account email in place of the placeholders, and the company's
// name where the draft only knew "the bank" or "the company".
export function fill(text: string, action: LoadedAction): string {
  const filled = text
    .replaceAll(PLACEHOLDERS.name, holderName(action.user.name) ?? "the account holder")
    .replaceAll(PLACEHOLDERS.email, action.user.email);
  return action.company
    ? filled.replace(/^Hello the (bank|company|provider),/m, `Hello ${action.company},`)
    : filled;
}

export async function record(
  userId: string,
  actionId: string,
  message: {
    direction: "outbound" | "inbound" | "note";
    to: string;
    from: string;
    subject: string;
    body: string;
  },
  reading: ReplyReading | null,
  client: PrismaClient,
) {
  await scopedFor(userId, client).agentMessages.create({
    data: {
      userId,
      actionId,
      direction: message.direction,
      toAddress: message.to,
      fromAddress: message.from,
      subject: message.subject.slice(0, 300),
      body: message.body.slice(0, AGENT_MAX_BODY),
      outcome: reading?.outcome ?? null,
      summary: reading?.summary ?? null,
    },
  });
}

// A step that isn't a message, for the timeline: "Passed to our team: …", "Saw $50.00
// come back on 2026-10-20".
export async function note(userId: string, actionId: string, text: string, client: PrismaClient) {
  await record(
    userId,
    actionId,
    { direction: "note", to: "", from: "Jane", subject: "", body: text },
    null,
    client,
  );
}

// Why a person's answer or report can't go through, in words to show them.
export class AnswerError extends Error {}
