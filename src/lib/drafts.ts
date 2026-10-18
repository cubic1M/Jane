import Anthropic from "@anthropic-ai/sdk";
import type { ActionType, FindingType } from "@/generated/prisma/client";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";
import { prepareExplainInput } from "./explain-input";
import { checkGuardrails } from "./guardrails";

// A message the concierge team can send (or read on a call) to the merchant, drafted by
// Claude from only what the merchant needs: their own name, the charges in question, and
// the request. Never the person's name, email, account names or numbers, transaction
// descriptions, or our savings estimate. The team fills in the placeholders.

export const DRAFT_PROMPT_VERSION = "draft-v1";

export const PLACEHOLDERS = {
  name: "[account holder name]",
  email: "[account email]",
} as const;

type DraftSpec = {
  channel: "email" | "call";
  // Who the message is to, when the payload doesn't name the merchant.
  recipient: string;
  // What to ask for, in a few words.
  request: string;
  // The facts from the finding the merchant needs; everything else is dropped.
  facts: readonly string[];
  // Whether the dates and amounts of the charges go in.
  charges: boolean;
};

// Action types the team contacts one company for. Moving cash, reshopping insurance and
// moving due dates with several billers have no single message to draft.
export const DRAFTABLE: Partial<Record<ActionType, DraftSpec>> = {
  cancel_subscription: {
    channel: "email",
    recipient: "the company",
    request: "cancel the subscription and confirm the cancellation in writing",
    facts: ["merchant", "latestCharge", "billed"],
    charges: false,
  },
  fight_price_increase: {
    channel: "email",
    recipient: "the company",
    request: "keep the previous price or offer a cheaper plan with the same service",
    facts: ["merchant", "previousPrice", "latestCharge"],
    charges: false,
  },
  request_refund: {
    channel: "email",
    recipient: "the company",
    request: "refund the charges listed",
    facts: ["merchant", "refundAmount", "cancelledOn", "trialCharge"],
    charges: true,
  },
  negotiate_bill: {
    channel: "call",
    recipient: "the provider",
    request: "a lower monthly price or a cheaper plan with the same service",
    facts: ["merchant", "perMonth", "kindOfBill"],
    charges: false,
  },
  recover_bank_fees: {
    channel: "email",
    recipient: "the bank",
    request: "refund these fees as a courtesy",
    facts: [],
    charges: true,
  },
  card_interest: {
    channel: "call",
    recipient: "the card company",
    request: "a lower interest rate on the card",
    facts: [],
    charges: false,
  },
};

export type DraftPayload = {
  channel: DraftSpec["channel"];
  to: string;
  request: string;
  facts: Record<string, string>;
  charges: { date: string; amount: string; kind?: string }[];
  placeholders: typeof PLACEHOLDERS;
};

export type Draft = { channel: DraftSpec["channel"]; subject: string; body: string };

export type DraftResult =
  | { kind: "llm"; draft: Draft; model: string }
  | { kind: "template"; draft: Draft; reason: "no_api_key" | "refused" | "invalid" | "guardrails" };

type FindingForDraft = { type: FindingType; evidence: unknown };

// Exactly what Claude sees. Built from the privacy-safe explain input, then cut down to
// the facts this kind of message needs.
export function draftPayload(
  actionType: ActionType,
  finding: FindingForDraft,
): { payload: DraftPayload; allowedCents: number[] } | null {
  const spec = DRAFTABLE[actionType];
  if (!spec) return null;
  const { input, allowedCents } = prepareExplainInput({
    type: finding.type,
    evidence: finding.evidence,
    // The merchant doesn't need our estimate of what this saves.
    annualSavingsCents: null,
  });
  const facts: Record<string, string> = {};
  for (const key of spec.facts) {
    const value = input.facts[key];
    if (typeof value === "string") facts[key] = value;
  }
  return {
    payload: {
      channel: spec.channel,
      to: facts.merchant ?? spec.recipient,
      request: spec.request,
      facts,
      charges: spec.charges ? input.charges : [],
      placeholders: PLACEHOLDERS,
    },
    allowedCents,
  };
}

// Fixed wording, used when Claude isn't available or its draft fails a check.
export function templateDraft(payload: DraftPayload): Draft {
  const lines = payload.charges.map(
    (c) => `- ${c.date}: ${c.amount}${c.kind ? ` (${c.kind})` : ""}`,
  );
  const charges = lines.length > 0 ? `\n\nThe charges:\n${lines.join("\n")}` : "";
  if (payload.channel === "call") {
    return {
      channel: "call",
      subject: "",
      body: `Hi, I'm calling on behalf of ${PLACEHOLDERS.name}, the account holder. They'd like to ask for ${payload.request}. What options do you have, what would the new monthly price be, and is there any contract or fee? Thank you; I'll confirm with them before accepting anything.${charges}`,
    };
  }
  return {
    channel: "email",
    subject: `Request from ${PLACEHOLDERS.name}`,
    body: `Hello ${payload.to},\n\nI'm writing on behalf of ${PLACEHOLDERS.name} (account email ${PLACEHOLDERS.email}). We'd like you to ${payload.request}.${charges}\n\nPlease reply to confirm. Thank you.\n\n${PLACEHOLDERS.name}`,
  };
}

const SYSTEM = `You draft a short message that a concierge team sends to a company on a customer's behalf (or reads on a phone call when channel is "call"). Use only the details in the input.

- Be polite, brief and specific: what we're asking for, and the dates and amounts when given.
- Use the placeholders exactly as written for the customer's name and email. Never invent names, account numbers or other details.
- Use only dollar amounts that appear in the input, written exactly as they appear.
- Don't threaten, don't mention lawyers, laws or regulators, and don't promise anything.
- For a call, write it as what the caller says; leave subject empty.`;

const SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
  additionalProperties: false,
};

const MAX_BODY = 2000;

export async function draftMessage(
  actionType: ActionType,
  finding: FindingForDraft,
  { client = anthropic } = {},
): Promise<DraftResult | null> {
  const prepared = draftPayload(actionType, finding);
  if (!prepared) return null;
  const { payload, allowedCents } = prepared;
  const template = templateDraft(payload);
  if (!llmEnabled()) return { kind: "template", draft: template, reason: "no_api_key" };

  let text: string | null;
  try {
    const response = await client().messages.create({
      model: llmModel(),
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    });
    text = finishedText(response);
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;
    console.error("Draft request failed", { status: error.status });
    text = null;
  }
  if (text === null) return { kind: "template", draft: template, reason: "refused" };

  let parsed: { subject?: unknown; body?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "template", draft: template, reason: "invalid" };
  }
  if (typeof parsed.body !== "string" || !parsed.body.trim() || parsed.body.length > MAX_BODY) {
    return { kind: "template", draft: template, reason: "invalid" };
  }
  const draft: Draft = {
    channel: payload.channel,
    subject: payload.channel === "call" ? "" : String(parsed.subject ?? "").trim(),
    body: parsed.body.trim(),
  };
  if (!checkGuardrails(`${draft.subject}\n${draft.body}`, allowedCents).ok) {
    return { kind: "template", draft: template, reason: "guardrails" };
  }
  return { kind: "llm", draft, model: llmModel() };
}
