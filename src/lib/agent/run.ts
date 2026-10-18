import { randomBytes } from "node:crypto";
import {
  AGENT_ACTION_TYPES,
  AGENT_FOLLOW_UP_DAYS,
  AGENT_MAX_BODY,
  AGENT_MAX_FOLLOW_UPS,
  AGENT_SIGNATURE,
} from "@/config/agent";
import { normalizeAlias } from "@/data-sources/merchant-directory";
import type { ActionStatus, ActionType, PrismaClient } from "@/generated/prisma/client";
import { sendStatusEmail, statusEmail } from "@/lib/action-emails";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { FINDING_STATUS } from "@/lib/action-status";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PLACEHOLDERS, draftMessage, draftPayload } from "@/lib/drafts";
import { checkGuardrails } from "@/lib/guardrails";
import { enqueueJob, runJob } from "@/lib/jobs";
import { merchantFor } from "@/lib/merchants";
import { agentFromAddress, mailMode, replyAddress, sendAgentMail, tokenFromAddress } from "./mail";
import { readReply, type ReplyReading } from "./read-reply";
import { simulatedAddress } from "./simulated-company";

// The action agent (spec step 51). An approved action of a type in AGENT_ACTION_TYPES is
// worked by the agent instead of the team: it emails the company from Jane's address,
// reads the reply, follows up, and passes the action to the team (with the reason) when
// it can't go on. Nothing here runs for an action that isn't approved.

type Options = {
  client?: PrismaClient;
  now?: Date;
  send?: typeof sendAgentMail;
  read?: typeof readReply;
  notify?: typeof sendStatusEmail;
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Statuses the agent may work in: approved and not finished.
const WORKABLE: readonly ActionStatus[] = ["queued", "in_progress", "waiting_on_user"];

export const isAgentAction = (type: ActionType) => AGENT_ACTION_TYPES.includes(type);

// Called when an action is approved: hands it to the agent and queues its first step.
// Returns the job, so a request can run it straight away.
export async function startAgent(
  userId: string,
  actionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  await scopedFor(userId, client).actions.updateMany({
    where: { id: actionId, agentState: null },
    data: {
      agentState: "working",
      agentNextAt: now,
      replyToken: randomBytes(16).toString("hex"),
    },
  });
  return enqueueJob("agent_step", { userId, actionId }, { client, now });
}

async function loadAction(userId: string, actionId: string, client: PrismaClient) {
  return scopedFor(userId, client).actions.findFirst({
    where: { id: actionId },
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      agentState: true,
      agentFollowUps: true,
      replyToken: true,
      decision: {
        select: {
          choice: true,
          undoneAt: true,
          findingId: true,
          cardSnapshot: true,
          finding: { select: { type: true, evidence: true } },
        },
      },
      user: { select: { email: true, name: true } },
      agentMessages: {
        where: { direction: "outbound" },
        orderBy: { createdAt: "asc" },
        select: { toAddress: true, subject: true, body: true },
      },
    },
  });
}

type LoadedAction = NonNullable<Awaited<ReturnType<typeof loadAction>>>;

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

const merchantOf = (action: LoadedAction) => {
  const merchant = (action.decision.finding.evidence as { merchant?: unknown } | null)?.merchant;
  return typeof merchant === "string" ? merchant : "the company";
};

const titleOf = (action: LoadedAction) => {
  const title = (action.decision.cardSnapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "Your request";
};

// Where to write: the directory's support email (added by the team, never guessed), or a
// simulated company in development.
async function recipientFor(action: LoadedAction, client: PrismaClient): Promise<string | null> {
  const merchant = merchantOf(action);
  if (mailMode() === "simulated") return simulatedAddress(merchant);
  const row = await merchantFor(normalizeAlias(merchant), { client });
  return row?.supportEmail ?? null;
}

async function setStatus(
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
        console.error("Agent status email failed", { actionId: action.id, error: String(error) }),
      );
    }
  }
}

// Passes the action to the team with the reason, back in the queue.
async function handOff(
  userId: string,
  action: LoadedAction,
  reason: string,
  options: Required<Pick<Options, "client" | "now" | "notify">>,
) {
  await scopedFor(userId, options.client).actions.updateMany({
    where: { id: action.id },
    data: { agentState: "handed_off", handoffReason: reason, agentNextAt: null, status: "queued" },
  });
  await logAudit(SYSTEM_ACTOR, "agent_handed_off", { type: "action", id: action.id }, { reason });
  await track(userId, "agent_handed_off", { action_type: action.type });
}

function fill(text: string, action: LoadedAction): string {
  return text
    .replaceAll(PLACEHOLDERS.name, action.user.name?.trim() || "the account holder")
    .replaceAll(PLACEHOLDERS.email, action.user.email);
}

async function record(
  userId: string,
  actionId: string,
  message: {
    direction: "outbound" | "inbound";
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

async function send(
  userId: string,
  action: LoadedAction,
  mail: { to: string; subject: string; body: string },
  { client, send: deliver }: { client: PrismaClient; send: typeof sendAgentMail },
) {
  const replyTo = replyAddress(action.replyToken ?? "");
  if (mailMode() === "email") {
    await deliver({ to: mail.to, subject: mail.subject, text: mail.body, replyTo });
  } else {
    // The simulated company answers through the same path a real reply takes.
    await enqueueJob("agent_simulated_reply", { userId, actionId: action.id }, { client });
  }
  await record(
    userId,
    action.id,
    { direction: "outbound", from: agentFromAddress(), ...mail },
    null,
    client,
  );
  await logAudit(
    SYSTEM_ACTOR,
    "agent_message_sent",
    { type: "action", id: action.id },
    {
      user_id: userId,
      follow_up: action.agentMessages.length > 0,
    },
  );
}

export type StepResult = "sent" | "followed_up" | "handed_off" | "waiting" | "skipped";

// One step: the first email, a follow-up when one is due, or a hand-off.
export async function agentStep(
  userId: string,
  actionId: string,
  {
    client = defaultClient,
    now = new Date(),
    send: deliver = sendAgentMail,
    notify = sendStatusEmail,
  }: Options = {},
): Promise<StepResult> {
  const action = await loadAction(userId, actionId, client);
  if (!action || !canAgentWork(action)) return "skipped";
  const options = { client, now, notify };

  if (mailMode() === "off") {
    await handOff(userId, action, "Email for the agent isn't set up yet.", options);
    return "handed_off";
  }
  const to = await recipientFor(action, client);
  if (!to) {
    await handOff(
      userId,
      action,
      `No support email for ${merchantOf(action)} in the merchant directory. Add one on /admin/merchants and the agent takes it from there, or contact them by hand.`,
      options,
    );
    return "handed_off";
  }

  const first = action.agentMessages[0];
  if (!first) {
    const finding = action.decision.finding;
    const draft = await draftMessage(action.type, finding);
    const prepared = draftPayload(action.type, finding);
    if (!draft || !prepared || draft.draft.channel !== "email") {
      await handOff(userId, action, "This kind of request needs a call, not an email.", options);
      return "handed_off";
    }
    const subject = fill(draft.draft.subject, action) || `Request about ${merchantOf(action)}`;
    const body = `${fill(draft.draft.body, action)}\n\nReplies to this email reach us.\n${AGENT_SIGNATURE}`;
    if (!checkGuardrails(`${subject}\n${body}`, prepared.allowedCents).ok) {
      await handOff(
        userId,
        action,
        "The message didn't pass Jane's checks; it needs a person.",
        options,
      );
      return "handed_off";
    }
    await send(userId, action, { to, subject, body }, { client, send: deliver });
    await setStatus(
      userId,
      action,
      "in_progress",
      {
        agentState: "waiting_reply",
        agentNextAt: new Date(now.getTime() + AGENT_FOLLOW_UP_DAYS * DAY_MS),
        userTodo: null,
      },
      options,
    );
    await track(userId, "agent_message_sent", { action_type: action.type, source: draft.kind });
    return "sent";
  }

  // Already written: follow up if nothing came back in time, then pass it on.
  if (action.agentState !== "waiting_reply") return "waiting";
  if (action.agentFollowUps >= AGENT_MAX_FOLLOW_UPS) {
    await handOff(
      userId,
      action,
      `No reply from ${merchantOf(action)} after ${AGENT_MAX_FOLLOW_UPS} follow-ups.`,
      options,
    );
    return "handed_off";
  }
  const quoted = first.body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  await send(
    userId,
    action,
    {
      to: first.toAddress,
      subject: first.subject.startsWith("Re: ") ? first.subject : `Re: ${first.subject}`,
      body: `Hello again,\n\nFollowing up on my message below. Could you let us know where this stands?\n\nThank you.\n${AGENT_SIGNATURE}\n\n${quoted}`,
    },
    { client, send: deliver },
  );
  await scopedFor(userId, client).actions.updateMany({
    where: { id: action.id },
    data: {
      agentFollowUps: { increment: 1 },
      agentNextAt: new Date(now.getTime() + AGENT_FOLLOW_UP_DAYS * DAY_MS),
    },
  });
  return "followed_up";
}

// A company's reply, by the token in the address it was sent to. Every reply is kept on
// the timeline; it's acted on only while the agent is waiting for one.
export async function handleReply(
  toAddress: string,
  mail: { from: string; subject: string; body: string },
  {
    client = defaultClient,
    now = new Date(),
    read = readReply,
    notify = sendStatusEmail,
  }: Options = {},
): Promise<"acted" | "kept" | "unknown"> {
  const token = tokenFromAddress(toAddress);
  // A system lookup by the reply token; everything after it is scoped to that person.
  const found = token
    ? await client.action.findUnique({
        where: { replyToken: token },
        select: { id: true, userId: true },
      })
    : null;
  if (!found) return "unknown";
  const { userId } = found;
  const action = await loadAction(userId, found.id, client);
  if (!action) return "unknown";

  const reading = await read({ subject: mail.subject, body: mail.body.slice(0, AGENT_MAX_BODY) });
  await record(
    userId,
    action.id,
    {
      direction: "inbound",
      to: toAddress,
      from: mail.from,
      subject: mail.subject,
      body: mail.body,
    },
    reading,
    client,
  );
  await logAudit(
    SYSTEM_ACTOR,
    "agent_reply_received",
    { type: "action", id: action.id },
    {
      user_id: userId,
      outcome: reading.outcome,
    },
  );
  if (!canAgentWork(action) || action.agentState !== "waiting_reply") return "kept";

  const options = { client, now, notify };
  const merchant = merchantOf(action);
  switch (reading.outcome) {
    case "done":
      await setStatus(
        userId,
        action,
        "done",
        { agentState: "finished", agentNextAt: null, userTodo: null },
        options,
      );
      await track(userId, "agent_action_done", { action_type: action.type });
      break;
    case "needs_info":
      await setStatus(
        userId,
        action,
        "waiting_on_user",
        {
          agentNextAt: null,
          userTodo: `${merchant} asked: ${reading.question ?? reading.summary} Answer on your actions page and Jane will reply.`,
        },
        options,
      );
      break;
    case "needs_person":
      await setStatus(
        userId,
        action,
        "waiting_on_user",
        {
          agentState: "handed_off",
          handoffReason: "The company wants to hear from the account holder directly.",
          agentNextAt: null,
          userTodo: `${merchant} wants to hear from you directly: ${reading.summary}`,
        },
        options,
      );
      break;
    case "refused":
      await handOff(
        userId,
        action,
        `${merchant} said no by email: "${reading.summary}" A call may still work.`,
        options,
      );
      break;
    default:
      await handOff(userId, action, "The company's reply needs a person to read it.", options);
  }
  return "acted";
}

export class AnswerError extends Error {}

// Card, account or other long numbers never go out in an answer.
const LONG_NUMBER = /\d[\d\s-]{10,}\d/;
const MAX_ANSWER = 1_000;

// The person answers a company's question; the agent sends it on and waits again.
export async function answerCompany(
  userId: string,
  actionId: string,
  answer: string,
  { client = defaultClient, now = new Date(), send: deliver = sendAgentMail }: Options = {},
): Promise<void> {
  const text = answer.trim();
  if (!text) throw new AnswerError("Write your answer first.");
  if (text.length > MAX_ANSWER) throw new AnswerError(`Keep it under ${MAX_ANSWER} characters.`);
  if (LONG_NUMBER.test(text)) {
    throw new AnswerError(
      "Leave out card and account numbers. If they need the last 4 digits, give only those.",
    );
  }
  const action = await loadAction(userId, actionId, client);
  const first = action?.agentMessages[0];
  if (!action || !first || !canAgentWork(action) || action.status !== "waiting_on_user") {
    throw new AnswerError("Jane isn't waiting on an answer for this one.");
  }
  await send(
    userId,
    action,
    {
      to: first.toAddress,
      subject: first.subject.startsWith("Re: ") ? first.subject : `Re: ${first.subject}`,
      body: `Hello,\n\nThank you. From the account holder: ${text}\n\nCould you go ahead with the request?\n\n${AGENT_SIGNATURE}`,
    },
    { client, send: deliver },
  );
  await setStatus(
    userId,
    action,
    "in_progress",
    {
      agentState: "waiting_reply",
      userTodo: null,
      agentNextAt: new Date(now.getTime() + AGENT_FOLLOW_UP_DAYS * DAY_MS),
    },
    { client, now, notify: sendStatusEmail },
  );
}

// The daily job: follow up (or hand off) every action whose follow-up is due.
export async function runAgentFollowUps({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<{ checked: number }> {
  // A system job across users: ids only, and agentStep scopes each one.
  const due = await client.action.findMany({
    where: { agentState: "waiting_reply", status: "in_progress", agentNextAt: { lte: now } },
    select: { id: true, userId: true },
    take: 200,
  });
  for (const action of due) {
    try {
      await agentStep(action.userId, action.id, { client, now });
    } catch (error) {
      console.error("Agent follow-up failed", { actionId: action.id, error: String(error) });
    }
  }
  return { checked: due.length };
}

// Runs the agent's first steps right after a request, then the jobs they queued for the
// same actions (the simulated company's reply, in development). Anything that fails stays
// queued for the daily job.
export async function runAgentNow(
  jobIds: (string | undefined)[],
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  const ids = jobIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const jobs = await client.job.findMany({ where: { id: { in: ids } }, select: { payload: true } });
  for (const id of ids) await runJob(id, { client });
  await runQueuedFor(
    jobs.map((j) => (j.payload as { actionId?: string }).actionId).filter(Boolean) as string[],
    { client },
  );
}

// Runs the agent jobs already queued for these actions (and nothing else).
export async function runQueuedFor(
  actionIds: string[],
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  for (const actionId of new Set(actionIds)) {
    const queued = await client.job.findMany({
      where: {
        status: "queued",
        kind: { in: ["agent_step", "agent_simulated_reply"] },
        payload: { path: ["actionId"], equals: actionId },
      },
      select: { id: true },
      orderBy: { runAt: "asc" },
    });
    for (const job of queued) await runJob(job.id, { client });
  }
}
