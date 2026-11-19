import { createHmac, timingSafeEqual } from "node:crypto";
import { RETELL } from "@/config/retell";
import { CALL_OUTCOMES, type CallOutcome, type CallResult } from "../provider";

// Retell's API, the part a test call needs (docs.retellai.com, read 2026-11-19).
// - POST /v2/create-phone-call { from_number, to_number, override_agent_id, metadata,
//   retell_llm_dynamic_variables (strings), idempotency_key }: the call object, with call_id.
// - Webhooks { event, call } signed in `X-Retell-Signature: v=<ms>,d=<hex>`, HMAC-SHA256 with the API
//   key over the raw body followed by v; v within five minutes. `call_analyzed` carries the
//   transcript and the agent's post-call extraction (call_analysis.custom_analysis_data).
// It never dials anything but a fiction number (RETELL.fictionNumber).

export type RetellCall = {
  call_id?: string;
  call_status?: string;
  disconnection_reason?: string | null;
  transcript?: string | null;
  metadata?: Record<string, unknown> | null;
  call_analysis?: {
    call_summary?: string | null;
    custom_analysis_data?: Record<string, unknown> | null;
  } | null;
};

export class RetellError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Retell request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "RetellError";
  }
}

type Env = Record<string, string | undefined>;

// On only by its switch with every key set.
export const retellTestOn = (env: Env = process.env) =>
  env[RETELL.switchEnv] === RETELL.switchValue &&
  Boolean(env[RETELL.apiKeyEnv] && env[RETELL.agentIdEnv] && env[RETELL.fromNumberEnv]);

export type TestCall = {
  // The action's reply token: the result comes back with it.
  token: string;
  // Retell's idempotency key: one call per action.
  actionId: string;
  company: string;
  script: string;
};

export function retellHttp({
  env = process.env,
  fetch: send = fetch,
}: { env?: Env; fetch?: typeof fetch } = {}) {
  return {
    // Calls the simulated company's fiction number and returns Retell's call id.
    async callSimulatedCompany(call: TestCall): Promise<string> {
      if (!retellTestOn(env)) throw new RetellError(null, "NOT_CONFIGURED");
      const to = RETELL.simulatedCompanyNumber;
      // Belt and braces: a change to the number above can't make it dial a real one.
      if (!RETELL.fictionNumber.test(to)) throw new RetellError(null, "NOT_FICTION");
      const key = `jane-${call.actionId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 255);
      const response = await send(`${RETELL.baseUrl}/v2/create-phone-call`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env[RETELL.apiKeyEnv]}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from_number: env[RETELL.fromNumberEnv],
          to_number: to,
          override_agent_id: env[RETELL.agentIdEnv],
          idempotency_key: key,
          metadata: { token: call.token },
          retell_llm_dynamic_variables: { company: call.company, script: call.script },
        }),
      });
      const body = (await response.json().catch(() => null)) as { call_id?: unknown } | null;
      if (!response.ok || typeof body?.call_id !== "string") {
        throw new RetellError(response.status, "REFUSED");
      }
      return body.call_id;
    },
  };
}

// Whether a webhook came from Retell: its signature over the raw body, recent.
export function retellSignatureValid(
  rawBody: string,
  header: string | null,
  { env = process.env, now = new Date() }: { env?: Env; now?: Date } = {},
): boolean {
  const key = env[RETELL.apiKeyEnv];
  const match = /^v=(\d{1,15}),d=([0-9a-f]{64})$/i.exec(header ?? "");
  if (!key || !match) return false;
  if (Math.abs(now.getTime() - Number(match[1])) > RETELL.toleranceMs) return false;
  const expected = createHmac("sha256", key)
    .update(rawBody + match[1])
    .digest();
  const given = Buffer.from(match[2]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const wholeCents = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

// A finished Retell call as the agent's call result. The test agent's post-call extraction says the
// outcome in Jane's words (outcome, new_monthly_cents, offer, offer_monthly_cents,
// offer_contract_months, offer_fee_cents); a call nobody answered is no_answer; anything else needs a
// person, never a guess.
export function callResultOf(call: RetellCall): CallResult {
  const transcript = (call.transcript ?? "").slice(0, 100_000);
  if ((RETELL.noAnswerReasons as readonly string[]).includes(call.disconnection_reason ?? "")) {
    return { outcome: "no_answer", transcript, newMonthlyCents: null, offer: null };
  }
  const data = call.call_analysis?.custom_analysis_data ?? {};
  const outcome = CALL_OUTCOMES.includes(data.outcome as CallOutcome)
    ? (data.outcome as CallOutcome)
    : "needs_person";
  const terms = {
    monthlyCents: wholeCents(data.offer_monthly_cents),
    contractMonths: wholeCents(data.offer_contract_months),
    feeCents: wholeCents(data.offer_fee_cents),
  };
  return {
    outcome,
    transcript,
    newMonthlyCents: outcome === "lowered" ? wholeCents(data.new_monthly_cents) : null,
    offer: outcome === "offer" && typeof data.offer === "string" ? data.offer.slice(0, 500) : null,
    offerTerms:
      outcome === "offer" &&
      terms.monthlyCents !== null &&
      terms.contractMonths !== null &&
      terms.feeCents !== null
        ? {
            monthlyCents: terms.monthlyCents,
            contractMonths: terms.contractMonths,
            feeCents: terms.feeCents,
          }
        : null,
  };
}
