import { randomBytes } from "node:crypto";
import {
  AGENT_ACTION_TYPES,
  AGENT_REQUESTS,
  CANCEL_CONFIRM_DEFAULT_DAYS,
  CANCEL_CONFIRM_GRACE_DAYS,
  AGENT_FOLLOW_UP_DAYS,
  AGENT_HOLD_HOURS,
  AGENT_MAX_BODY,
  AGENT_MAX_FOLLOW_UPS,
  AGENT_SIGNATURE,
} from "@/config/agent";
import { CHARGES_PER_YEAR } from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { normalizeAlias } from "@/data-sources/merchant-directory";
import type {
  ActionStatus,
  ActionType,
  DecisionSource,
  PrismaClient,
} from "@/generated/prisma/client";
import { sendStatusEmail, statusEmail } from "@/lib/action-emails";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { FINDING_STATUS } from "@/lib/action-status";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PLACEHOLDERS, draftMessage, draftPayload } from "@/lib/drafts";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { DecisionError, recordDecision } from "@/lib/decisions";
import { checkGuardrails } from "@/lib/guardrails";
import { enqueueJob, runJob } from "@/lib/jobs";
import { merchantFor } from "@/lib/merchants";
import { agentFromAddress, mailMode, replyAddress, sendAgentMail, tokenFromAddress } from "./mail";
import { readReply, type ReplyReading } from "./read-reply";
import { findSupportContact } from "./find-contact";
import { composeAnswer, whatIsAsked, type KnownFacts } from "./auto-answer";
import { simulatedAddress } from "./simulated-company";
import { confirmSwitches, startSwitch, switchOf } from "./switch";
import { insuranceSwitchOf } from "@/lib/insurance/accept";
import { confirmInsuranceSwitches, startInsuranceSwitch } from "@/lib/insurance/switch";
import { isCallAction, startCall } from "@/lib/voice/calls";

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

// The start of the hand-off reason when a company has no support email, so the actions can
// be picked up again once the team adds one.
export const NO_SUPPORT_EMAIL = "No support email in the merchant directory for";

// Called when an action is approved: hands it to the agent and queues its first step.
// Returns the job, so a request can run it straight away.
export async function startAgent(
  userId: string,
  actionId: string,
  {
    client = defaultClient,
    now = new Date(),
    source = "card",
  }: Options & { source?: DecisionSource } = {},
): Promise<string> {
  // Approvals made outside the app wait out the time to take them back.
  const holdHours = AGENT_HOLD_HOURS[source as keyof typeof AGENT_HOLD_HOURS] ?? 0;
  const startAt = new Date(now.getTime() + holdHours * 60 * 60 * 1000);
  await scopedFor(userId, client).actions.updateMany({
    where: { id: actionId, agentState: null },
    data: {
      agentState: "working",
      agentNextAt: startAt,
      replyToken: randomBytes(16).toString("hex"),
    },
  });
  return enqueueJob("agent_step", { userId, actionId }, { client, now, runAt: startAt });
}

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

// Where to write: the directory's support email (added by the team, never guessed), or a
// simulated company in development.
async function recipientFor(
  userId: string,
  action: LoadedAction,
  client: PrismaClient,
): Promise<string | null> {
  if (!action.company) return null;
  if (mailMode(userId) === "simulated") return simulatedAddress(action.company);
  const row = await merchantFor(normalizeAlias(action.company), { client });
  return row?.supportEmail ?? null;
}

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
        console.error("Agent status email failed", { actionId: action.id, error: String(error) }),
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
  await note(userId, action.id, `Passed to our team: ${reason}`, options.client);
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
    .replaceAll(PLACEHOLDERS.name, action.user.name?.trim() || "the account holder")
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

async function send(
  userId: string,
  action: LoadedAction,
  mail: { to: string; subject: string; body: string },
  { client, send: deliver }: { client: PrismaClient; send: typeof sendAgentMail },
) {
  const replyTo = replyAddress(action.replyToken ?? "");
  if (mailMode(userId) === "email") {
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

  // A switch to an option the person picked (spec steps 76–77) replaces the usual request.
  if (switchOf(action.decision.options)) return startSwitch(userId, action, options);
  // Spec step 105: an insurance switch is bound through the insurance partner.
  if (insuranceSwitchOf(action.decision.options)) {
    return startInsuranceSwitch(userId, action, options);
  }

  // Bills are negotiated by phone (src/lib/voice/calls.ts), once.
  if (isCallAction(action.type)) {
    if (action.agentMessages.length > 0) return "waiting";
    return (await startCall(userId, action, options)) === "called" ? "sent" : "handed_off";
  }
  if (mailMode(userId) === "off") {
    await handOff(userId, action, "Email for the agent isn't set up yet.", options);
    return "handed_off";
  }
  if (!action.company) {
    await handOff(
      userId,
      action,
      action.type === "recover_bank_fees"
        ? "We don't know which bank holds this account (it was imported from a file). Contact the bank by hand, or link the account so Jane knows."
        : "This request covers more than one company; a person needs to pick which one.",
      options,
    );
    return "handed_off";
  }
  const chosen = (action.decision.options ?? {}) as Record<string, unknown>;
  if (action.type === "request_refund" && chosen.method === "dispute") {
    await handOff(
      userId,
      action,
      "The person chose to dispute this with their card; that goes to the card company, not the merchant.",
      options,
    );
    return "handed_off";
  }
  // Some companies only cancel from the account holder's own page: the person gets the
  // link, and Jane confirms by watching for the next charge.
  if (action.type === "cancel_subscription" && action.agentMessages.length === 0) {
    const row = await merchantFor(normalizeAlias(action.company), { client });
    if (row?.cancelUrl && !row.supportEmail) {
      await setStatus(
        userId,
        action,
        "waiting_on_user",
        {
          agentState: "confirming",
          agentNextAt: null,
          selfServiceUrl: row.cancelUrl,
          // Jane watches for the next charge from now, whether or not the person says
          // they've cancelled (spec step 61).
          confirmAfter: confirmDate(
            action.decision.finding.evidence,
            new Date(`${isoDay(now)}T00:00:00Z`),
          ),
          userTodo: `${action.company} only cancels from your own account. Open their cancel page and cancel. Jane watches for the next charge, so you don't need to tell Jane (you can tap "I've cancelled" if you like).`,
        },
        options,
      );
      await note(userId, action.id, `Asked you to cancel on ${action.company}'s own page.`, client);
      return "waiting";
    }
  }
  const to = await recipientFor(userId, action, client);
  if (!to) {
    await handOff(
      userId,
      action,
      `${NO_SUPPORT_EMAIL} ${merchantOf(action)}. Add or confirm one on /admin/merchants and the agent takes it from there, or contact them by hand.`,
      options,
    );
    // Jane looks for one on the company's own site, for the team to confirm (step 64).
    await enqueueJob("find_support_contact", { userId, actionId: action.id }, { client, now });
    return "handed_off";
  }

  const first = action.agentMessages[0];
  if (!first) {
    const finding = action.decision.finding;
    // What the person picked on the plan, e.g. a downgrade instead of a cancel.
    const choice =
      action.type === "cancel_subscription"
        ? chosen.plan
        : action.type === "fight_price_increase"
          ? chosen.ask
          : undefined;
    const request =
      (typeof choice === "string" ? AGENT_REQUESTS[action.type]?.[choice] : null) ?? undefined;
    const draft = await draftMessage(action.type, finding, { request });
    const prepared = draftPayload(action.type, finding, { request });
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
    send: deliver = sendAgentMail,
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
    case "needs_info": {
      const question = reading.question ?? reading.summary;
      const asked = whatIsAsked(question);
      if (asked.kind === "never") {
        // Jane never gives these out; a request for them by email is unusual.
        await setStatus(
          userId,
          action,
          "waiting_on_user",
          {
            agentState: "handed_off",
            handoffReason: "The company asked for something Jane never shares.",
            agentNextAt: null,
            userTodo: `${merchant} asked: ${question} Jane never shares that, and it's unusual to ask by email. Don't reply with it; if you think it's genuine, contact ${merchant} yourself. Our team will follow up.`,
          },
          options,
        );
        await note(userId, action.id, `${merchant} asked for something Jane never shares.`, client);
        break;
      }
      // Answered from the person's own data when Jane knows everything asked.
      const answer =
        asked.kind === "facts"
          ? composeAnswer(asked.facts, await knownFacts(userId, action, client))
          : null;
      if (answer) {
        await replyToCompany(userId, action, `From the account holder's records: ${answer}`, {
          client,
          now,
          deliver,
        });
        await note(userId, action.id, `Answered ${merchant}'s question: ${answer}`, client);
        await track(userId, "agent_answered_itself", { action_type: action.type });
        break;
      }
      await setStatus(
        userId,
        action,
        "waiting_on_user",
        {
          agentNextAt: null,
          userTodo: `${merchant} asked: ${question} Answer on your actions page and Jane will reply.`,
        },
        options,
      );
      break;
    }
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
  await replyToCompany(userId, action, `From the account holder: ${text}`, {
    client,
    now,
    deliver,
  });
}

// Sends an answer to the company's question and waits for their reply again.
async function replyToCompany(
  userId: string,
  action: LoadedAction,
  answer: string,
  { client, now, deliver }: { client: PrismaClient; now: Date; deliver: typeof sendAgentMail },
) {
  const first = action.agentMessages[0];
  await send(
    userId,
    action,
    {
      to: first.toAddress,
      subject: first.subject.startsWith("Re: ") ? first.subject : `Re: ${first.subject}`,
      body: `Hello,\n\nThank you. ${answer}\n\nCould you go ahead with the request?\n\n${AGENT_SIGNATURE}`,
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

// What Jane knows that a company may ask about: the card's last 4 digits (from the
// account the charge was on), the account email and name, and the charges themselves.
async function knownFacts(
  userId: string,
  action: LoadedAction,
  client: PrismaClient,
): Promise<KnownFacts> {
  const evidence = (action.decision.finding.evidence ?? {}) as {
    accountId?: unknown;
    charges?: unknown;
  };
  const charges = (Array.isArray(evidence.charges) ? evidence.charges : [])
    .map((c) => c as { date?: unknown; amountCents?: unknown; accountId?: unknown })
    .filter((c) => typeof c.date === "string" && typeof c.amountCents === "number");
  const accountId =
    typeof evidence.accountId === "string"
      ? evidence.accountId
      : (charges.find((c) => typeof c.accountId === "string")?.accountId as string | undefined);
  const account = accountId
    ? await scopedFor(userId, client).accounts.findFirst({
        where: { id: accountId },
        select: { mask: true },
      })
    : null;
  return {
    cardLast4: account?.mask ?? null,
    email: action.user.email,
    name: action.user.name,
    charges: charges.map((c) => ({ date: c.date as string, amountCents: c.amountCents as number })),
  };
}

// The daily job: follow up (or hand off) every action whose follow-up is due, and settle
// cancellations whose wait for a missed charge is over.
export async function runAgentFollowUps({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<{
  checked: number;
  confirmed: number;
  charged: number;
  switched: number;
  handedOff: number;
}> {
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
  const cancellations = await confirmCancellations({ client, now });
  const switches = await confirmSwitches({ client, now });
  // Spec step 105: insurance switches whose first payment went through.
  const insurance = await confirmInsuranceSwitches({ client, now });
  return {
    checked: due.length,
    ...cancellations,
    switched: switches.switched + insurance.switched,
    handedOff: switches.handedOff + insurance.handedOff,
  };
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
        kind: { in: ["agent_step", "agent_simulated_reply", "voice_simulated_result"] },
        payload: { path: ["actionId"], equals: actionId },
      },
      select: { id: true },
      orderBy: { runAt: "asc" },
    });
    for (const job of queued) await runJob(job.id, { client });
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// When a missed charge confirms a cancellation: the next charge's due date (from the last
// charge and how often it charged) plus a few days' grace.
export function confirmDate(evidence: unknown, cancelledOn: Date): Date {
  const facts = (evidence ?? {}) as { frequency?: unknown; charges?: unknown };
  const perYear =
    typeof facts.frequency === "string"
      ? (CHARGES_PER_YEAR as Record<string, number>)[facts.frequency]
      : undefined;
  const dates = (Array.isArray(facts.charges) ? facts.charges : [])
    .map((c) => (c as { date?: unknown }).date)
    .filter((d): d is string => typeof d === "string")
    .sort();
  const last = dates.at(-1);
  const due =
    perYear && last
      ? new Date(new Date(`${last}T00:00:00Z`).getTime() + Math.round(365 / perYear) * DAY_MS)
      : new Date(cancelledOn.getTime() + CANCEL_CONFIRM_DEFAULT_DAYS * DAY_MS);
  const from = due > cancelledOn ? due : cancelledOn;
  return new Date(from.getTime() + CANCEL_CONFIRM_GRACE_DAYS * DAY_MS);
}

// The person says they cancelled on the company's page. Jane waits for the next charge
// date to pass without a charge before calling it done.
export async function markSelfCancelled(
  userId: string,
  actionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const action = await loadAction(userId, actionId, client);
  if (
    !action ||
    action.type !== "cancel_subscription" ||
    action.agentState !== "confirming" ||
    action.status !== "waiting_on_user" ||
    action.decision.choice !== "yes" ||
    action.decision.undoneAt !== null
  ) {
    throw new AnswerError("Jane isn't waiting on a cancellation for this one.");
  }
  const cancelledOn = new Date(`${isoDay(now)}T00:00:00Z`);
  await setStatus(
    userId,
    action,
    "in_progress",
    {
      cancelledOn,
      confirmAfter: confirmDate(action.decision.finding.evidence, cancelledOn),
      userTodo: null,
    },
    { client, now, notify: sendStatusEmail },
  );
  await note(
    userId,
    action.id,
    `You cancelled on ${isoDay(cancelledOn)}. Jane is watching for the next charge to make sure.`,
    client,
  );
  await track(userId, "self_cancel_reported", { action_type: action.type });
}

// Confirms (or questions) cancellations whose wait is over: no charge from the company
// since the person cancelled means done; a charge means it may not have gone through.
export async function confirmCancellations({
  client = defaultClient,
  now = new Date(),
  notify = sendStatusEmail,
}: Options = {}): Promise<{ confirmed: number; charged: number; reminded: number }> {
  // A system job across users: ids only, and everything after is scoped to the person.
  const due = await client.action.findMany({
    where: {
      type: "cancel_subscription",
      agentState: "confirming",
      status: { in: ["in_progress", "waiting_on_user"] },
      confirmAfter: { lte: new Date(`${isoDay(now)}T00:00:00Z`) },
    },
    select: { id: true, userId: true },
    take: 200,
  });
  const counts = { confirmed: 0, charged: 0, reminded: 0 };
  for (const { id, userId } of due) {
    const action = await loadAction(userId, id, client);
    // Watched from the day they said they cancelled, or else from the day Jane gave them
    // the company's cancel page (spec step 61).
    const since = action?.cancelledOn ?? action?.startedAt;
    if (!action || !since || !action.company) continue;
    const want = normalizeMerchant(action.company)?.key;
    const charges = await scopedFor(userId, client).transactions.findMany({
      where: { amountCents: { gt: 0 }, date: { gt: new Date(`${isoDay(since)}T00:00:00Z`) } },
      select: { date: true, amountCents: true, description: true, merchantName: true },
      orderBy: { date: "desc" },
    });
    const after = charges.find((c) => {
      const got = normalizeMerchant(c.merchantName ?? c.description)?.key;
      return Boolean(want && got && (got === want || got.startsWith(`${want} `)));
    });
    if (!after) {
      await setStatus(
        userId,
        action,
        "done",
        { agentState: "finished", confirmAfter: null, userTodo: null },
        { client, now, notify },
      );
      await note(
        userId,
        id,
        action.cancelledOn
          ? `No charge from ${action.company} since you cancelled: done.`
          : `No charge from ${action.company} since Jane gave you their cancel page: cancelled.`,
        client,
      );
      await track(userId, "cancellation_confirmed", {
        by: action.cancelledOn ? "missed_charge" : "missed_charge_untold",
      });
      counts.confirmed += 1;
    } else if (action.cancelledOn) {
      await setStatus(
        userId,
        action,
        "waiting_on_user",
        {
          agentState: "handed_off",
          handoffReason: `${action.company} charged again after the person cancelled on their page.`,
          confirmAfter: null,
          userTodo: `${action.company} charged you again on ${isoDay(after.date)} after you cancelled, so the cancellation may not have gone through. Check your account with them; our team will follow up too.`,
        },
        { client, now, notify },
      );
      await note(
        userId,
        id,
        `${action.company} charged again on ${isoDay(after.date)} after you cancelled.`,
        client,
      );
      counts.charged += 1;
    } else {
      // Not cancelled yet: remind, and watch the next cycle.
      const evidence = (action.decision.finding.evidence ?? {}) as { frequency?: unknown };
      await setStatus(
        userId,
        action,
        "waiting_on_user",
        {
          confirmAfter: confirmDate(
            { frequency: evidence.frequency, charges: [{ date: isoDay(after.date) }] },
            new Date(`${isoDay(now)}T00:00:00Z`),
          ),
          userTodo: `${action.company} charged you on ${isoDay(after.date)}, so the subscription looks active. Cancel on their page to stop the next charge; Jane keeps watching.`,
        },
        { client, now, notify },
      );
      await note(
        userId,
        id,
        `${action.company} charged on ${isoDay(after.date)}: still active, reminded you to cancel.`,
        client,
      );
      counts.reminded += 1;
    }
  }
  return counts;
}

// A company charged after a cancellation the person approved: Jane asks for that money
// back on its own (logged as an automatic follow-up of the earlier yes).
export async function refundChargesAfterCancel(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<string[]> {
  const db = scopedFor(userId, client);
  const findings = await db.findings.findMany({
    where: { type: "charge_after_cancel", status: { in: ["new", "shown"] } },
    select: CARD_SELECT,
  });
  const approved: string[] = [];
  for (const finding of findings) {
    try {
      const { decisionId } = await recordDecision(
        userId,
        {
          findingId: finding.id,
          choice: "yes",
          cardHash: cardHash(buildCard(finding)),
          source: "auto",
          ruleKey: "charge_after_cancel",
        },
        { client },
      );
      approved.push(decisionId);
    } catch (error) {
      if (!(error instanceof DecisionError)) throw error;
    }
  }
  return approved;
}

// The job behind a missing support email: looks it up on the company's own site.
export async function lookUpSupportFor(
  userId: string,
  actionId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  const action = await loadAction(userId, actionId, client);
  if (!action?.company) return;
  const row = await merchantFor(normalizeAlias(action.company), { client });
  if (row) await findSupportContact(row.id, { client });
}

// Once the team adds or confirms a merchant's support email, the agent picks up the
// actions it had passed on for lack of one. Returns how many.
export async function resumeForMerchant(
  merchantName: string,
  { client = defaultClient, now = new Date() }: Pick<Options, "client" | "now"> = {},
): Promise<number> {
  // A system lookup across people: ids only; each is then scoped.
  const waiting = await client.action.findMany({
    where: {
      agentState: "handed_off",
      status: "queued",
      handoffReason: { startsWith: `${NO_SUPPORT_EMAIL} ${merchantName}.` },
    },
    select: { id: true, userId: true },
  });
  for (const { id, userId } of waiting) {
    await scopedFor(userId, client).actions.updateMany({
      where: { id, agentState: "handed_off" },
      data: { agentState: "working", handoffReason: null, agentNextAt: now },
    });
    await note(
      userId,
      id,
      `${merchantName}'s support email was added: Jane is taking it back.`,
      client,
    );
    await enqueueJob("agent_step", { userId, actionId: id }, { client, now });
  }
  return waiting.length;
}
