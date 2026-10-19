import { AGENT_CALL_TYPES } from "@/config/agent";
import { normalizeAlias } from "@/data-sources/merchant-directory";
import type { PrismaClient } from "@/generated/prisma/client";
import { sendStatusEmail } from "@/lib/action-emails";
import {
  AnswerError,
  fill,
  handOff,
  loadAction,
  merchantOf,
  note,
  record,
  setStatus,
  type LoadedAction,
} from "@/lib/agent/run";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PLACEHOLDERS, draftMessage, draftPayload } from "@/lib/drafts";
import { checkGuardrails } from "@/lib/guardrails";
import { enqueueJob } from "@/lib/jobs";
import { merchantFor } from "@/lib/merchants";
import { formatCents } from "@/lib/money";
import {
  CALL_OUTCOMES,
  SIMULATED_NUMBER,
  callMode,
  simulatedCall,
  type CallResult,
} from "./provider";

// The agent's phone calls (spec step 54): bill negotiation. A call only ever happens with
// the person's own yes on that bill. The script comes from the playbook and the draft; the
// call's transcript and outcome go on the action's timeline. Anything with a contract,
// a fee or a new plan is never accepted on the call: the person decides.

type Options = { client?: PrismaClient; now?: Date; notify?: typeof sendStatusEmail };

export const isCallAction = (type: string) =>
  (AGENT_CALL_TYPES as readonly string[]).includes(type);

type BillFacts = { monthlyCents: number | null; typicalHighCents: number | null };

const billFacts = (action: LoadedAction): BillFacts => {
  const e = (action.decision.finding.evidence ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return { monthlyCents: num(e.monthlyCents), typicalHighCents: num(e.typicalHighCents) };
};

// The price to aim for: the person's own number from the plan, or the top of the typical
// range we showed them.
function targetCents(action: LoadedAction): number | null {
  const chosen = (action.decision.options ?? {}) as { targetMonthly?: unknown };
  if (typeof chosen.targetMonthly === "number") return chosen.targetMonthly;
  return billFacts(action).typicalHighCents;
}

// Starts the call for an approved bill. Returns what happened.
export async function startCall(
  userId: string,
  action: LoadedAction,
  { client = defaultClient, now = new Date(), notify = sendStatusEmail }: Options = {},
): Promise<"called" | "handed_off"> {
  const options = { client, now, notify };
  // Belt and braces: only the person's own yes on this bill starts a call.
  if (action.decision.source === "rule" || action.decision.source === "auto") {
    await handOff(
      userId,
      action,
      "Calls need the person's own yes; a rule can't start one.",
      options,
    );
    return "handed_off";
  }
  if (callMode() === "off") {
    await handOff(userId, action, "Calls aren't set up yet: the team calls instead.", options);
    return "handed_off";
  }
  const company = merchantOf(action);
  const row = await merchantFor(normalizeAlias(company), { client });
  const phone = callMode() === "simulated" ? SIMULATED_NUMBER : row?.supportPhone;
  const target = targetCents(action);
  const { monthlyCents } = billFacts(action);
  if (!phone || target === null || monthlyCents === null) {
    await handOff(
      userId,
      action,
      !phone
        ? `No support phone for ${company} in the merchant directory.`
        : "The bill's price or the price to aim for is missing.",
      options,
    );
    return "handed_off";
  }

  const finding = action.decision.finding;
  const draft = await draftMessage(action.type, finding);
  const prepared = draftPayload(action.type, finding);
  if (!draft || !prepared) {
    await handOff(userId, action, "No call script for this request.", options);
    return "handed_off";
  }
  const script = [
    "This call may be recorded.",
    fill(draft.draft.body, action).replaceAll(PLACEHOLDERS.name, "the account holder"),
    `The typical price for this kind of service is up to ${formatCents(target)} a month; they pay ${formatCents(monthlyCents)}.`,
    action.user.acceptSimpleOffers
      ? "You may accept a lower monthly price, even on a different plan of the same service, if there's no contract and no fee. Anything with a contract or a fee: write it down and say the account holder will decide."
      : "Don't accept a contract, a fee or a different plan: write the offer down and say the account holder will decide.",
  ].join("\n\n");
  const allowed = [...prepared.allowedCents, target, monthlyCents];
  if (!checkGuardrails(script, allowed, "bill_negotiation").ok) {
    await handOff(
      userId,
      action,
      "The call script didn't pass Jane's checks; it needs a person.",
      options,
    );
    return "handed_off";
  }

  await record(
    userId,
    action.id,
    {
      direction: "outbound",
      to: `tel:${phone}`,
      from: "Jane",
      subject: "Phone call",
      body: script,
    },
    null,
    client,
  );
  // A real provider would be asked to call here; the simulated one answers through a job.
  await enqueueJob("voice_simulated_result", { userId, actionId: action.id }, { client, now });
  await setStatus(
    userId,
    action,
    "in_progress",
    { agentState: "waiting_reply", agentNextAt: null, userTodo: null },
    options,
  );
  await logAudit(
    SYSTEM_ACTOR,
    "agent_call_started",
    { type: "action", id: action.id },
    {
      user_id: userId,
    },
  );
  await track(userId, "agent_call_started", { action_type: action.type });
  return "called";
}

// A call's result, by the action's token. Kept on the timeline; acted on only while the
// agent is waiting for it.
export async function handleCallResult(
  token: string,
  result: CallResult,
  { client = defaultClient, now = new Date(), notify = sendStatusEmail }: Options = {},
): Promise<"acted" | "kept" | "unknown"> {
  if (!CALL_OUTCOMES.includes(result.outcome)) return "unknown";
  // A system lookup by the token; everything after it is scoped to that person.
  const found = await client.action.findUnique({
    where: { replyToken: token },
    select: { id: true, userId: true },
  });
  if (!found) return "unknown";
  const { userId } = found;
  const action = await loadAction(userId, found.id, client);
  if (!action || !isCallAction(action.type)) return "unknown";
  const company = merchantOf(action);
  const { monthlyCents } = billFacts(action);
  const summary = {
    lowered: `${company} lowered the bill to ${result.newMonthlyCents === null ? "a lower price" : formatCents(result.newMonthlyCents)} a month.`,
    offer: `${company} offered ${result.offer ?? "a new plan"}; the account holder decides.`,
    refused: `${company} had no offers.`,
    needs_person: `${company} will only talk to the account holder.`,
    no_answer: `Nobody at ${company} picked up.`,
  }[result.outcome];
  await record(
    userId,
    action.id,
    {
      direction: "inbound",
      to: "Jane",
      from: `tel:${company}`,
      subject: "Call result",
      body: result.transcript,
    },
    {
      outcome:
        result.outcome === "lowered"
          ? "done"
          : result.outcome === "offer"
            ? "needs_info"
            : result.outcome === "needs_person"
              ? "needs_person"
              : "refused",
      summary,
      question: null,
      source: "rules",
    },
    client,
  );
  if (action.agentState !== "waiting_reply" || action.status !== "in_progress") return "kept";

  const options = { client, now, notify };
  // An offer inside the person's limit (spec step 62) counts as accepted on the call.
  const terms = result.offerTerms;
  const withinLimit =
    result.outcome === "offer" &&
    action.user.acceptSimpleOffers &&
    terms !== undefined &&
    terms !== null &&
    terms.contractMonths === 0 &&
    terms.feeCents === 0 &&
    monthlyCents !== null &&
    terms.monthlyCents < monthlyCents;
  const lowerTo = withinLimit ? terms!.monthlyCents : result.newMonthlyCents;
  if (
    (result.outcome === "lowered" || withinLimit) &&
    lowerTo !== null &&
    monthlyCents !== null &&
    lowerTo < monthlyCents
  ) {
    await setStatus(
      userId,
      action,
      "done",
      {
        agentState: "finished",
        confirmedAnnualCents: (monthlyCents - lowerTo) * 12,
        userTodo: null,
      },
      options,
    );
    if (withinLimit) {
      await note(
        userId,
        action.id,
        `Accepted on the call, within your limit: ${result.offer ?? "a lower price"}.`,
        client,
      );
    }
    await track(userId, "agent_call_lowered", { action_type: action.type });
  } else if (result.outcome === "offer") {
    await setStatus(
      userId,
      action,
      "waiting_on_user",
      {
        agentState: "confirming",
        userTodo: `${company} offered ${result.offer ?? "a new plan"}. Nothing was accepted: say yes or no on your actions page.`,
      },
      options,
    );
  } else if (result.outcome === "needs_person") {
    await setStatus(
      userId,
      action,
      "waiting_on_user",
      {
        agentState: "handed_off",
        handoffReason: "The provider will only talk to the account holder.",
        userTodo: `${company} will only discuss the account with you. Our team will set up a three-way call.`,
      },
      options,
    );
  } else {
    await handOff(userId, action, `On the call: ${summary}`, options);
  }
  return "acted";
}

// The person's answer to an offer made on the call. Accepting goes to the team to put in
// place with the provider; declining closes the action.
export async function answerOffer(
  userId: string,
  actionId: string,
  accept: boolean,
  { client = defaultClient, now = new Date(), notify = sendStatusEmail }: Options = {},
): Promise<void> {
  const action = await loadAction(userId, actionId, client);
  if (
    !action ||
    !isCallAction(action.type) ||
    action.status !== "waiting_on_user" ||
    action.agentState !== "confirming"
  ) {
    throw new AnswerError("There's no offer waiting on you for this one.");
  }
  const options = { client, now, notify };
  if (accept) {
    await handOff(
      userId,
      action,
      "The person accepted the offer made on the call; put it in place.",
      options,
    );
  } else {
    await setStatus(
      userId,
      action,
      "failed",
      { agentState: "finished", userTodo: null, failureReason: "The person declined the offer." },
      options,
    );
  }
  await note(
    userId,
    action.id,
    accept ? "You accepted the offer." : "You declined the offer; nothing changes.",
    client,
  );
  await track(userId, accept ? "call_offer_accepted" : "call_offer_declined", {});
}

// The job behind a simulated call: works out the provider's answer and hands it back
// through the same path a real provider's result takes.
export async function simulatedCallResult(
  userId: string,
  actionId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  const action = await loadAction(userId, actionId, client);
  const token = (
    await scopedFor(userId, client).actions.findFirst({
      where: { id: actionId },
      select: { replyToken: true },
    })
  )?.replyToken;
  if (!action || !token) return;
  const { monthlyCents } = billFacts(action);
  const target = targetCents(action);
  if (monthlyCents === null || target === null) return;
  await handleCallResult(
    token,
    simulatedCall(action.id, merchantOf(action), monthlyCents, target),
    {
      client,
    },
  );
}
