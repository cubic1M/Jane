import { createHmac, timingSafeEqual } from "node:crypto";
import { requireGrant } from "@/lib/permission/gate";
import { CALL_OUTCOMES, type CallOutcome, type CallResult } from "./provider";

// Phone calls through Retell, for when real calls are turned on. NEVER RUN against Retell: built from
// its docs (docs.retellai.com: create-phone-call, webhook-overview, secure-webhook, read 2026-11-02)
// and tested against a mock. callMode (./provider.ts) doesn't use it: calls stay simulated or off.
// Before going live, check Retell's auth header (its reference names an api_key scheme, not the
// header) and how a post-call analysis is set up to give the fields below.

const RETELL_API = "https://api.retellai.com";
// How far a signature's timestamp may be from now (its secure-webhook page).
export const RETELL_TOLERANCE_MS = 5 * 60 * 1000;

// "v={timestamp ms},d={hex}": HMAC-SHA256 of the raw body then the timestamp, keyed with the API key.
export function verifyRetellSignature(
  rawBody: string,
  header: string | null,
  apiKey: string,
  now: Date,
): boolean {
  const match = /^v=(\d+),d=(.+)$/.exec(header ?? "");
  if (!match || !apiKey) return false;
  const [, timestamp, digest] = match;
  if (Math.abs(now.getTime() - Number(timestamp)) > RETELL_TOLERANCE_MS) return false;
  const expected = createHmac("sha256", apiKey).update(`${rawBody}${timestamp}`).digest("hex");
  const [x, y] = [Buffer.from(digest), Buffer.from(expected)];
  return x.length === y.length && timingSafeEqual(x, y);
}

// Only inside the permission check (src/lib/permission/check.ts).
export async function placeRetellCall(
  call: { to: string; from: string; token: string; script: string },
  { apiKey, fetcher = fetch }: { apiKey: string; fetcher?: typeof fetch },
): Promise<{ callId: string }> {
  requireGrant("phone_agent");
  const response = await fetcher(`${RETELL_API}/v2/create-phone-call`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from_number: call.from,
      to_number: call.to,
      retell_llm_dynamic_variables: { script: call.script },
      // Comes back on the webhooks: how a result finds its action.
      metadata: { token: call.token },
    }),
  });
  if (!response.ok) throw new Error(`Retell answered ${response.status} to a call`);
  const body = (await response.json()) as { call_id?: unknown };
  if (typeof body.call_id !== "string") throw new Error("Retell gave no call id");
  return { callId: body.call_id };
}

const NOT_REACHED = ["dial_failed", "dial_no_answer", "dial_busy"];

type RetellCall = {
  metadata?: { token?: unknown } | null;
  transcript?: unknown;
  disconnection_reason?: unknown;
  // What the post-call analysis is set up to give: the outcome and any new price.
  call_analysis?: {
    custom_analysis_data?: {
      outcome?: unknown;
      new_monthly_cents?: unknown;
      offer?: unknown;
    } | null;
  } | null;
};

// A call_analyzed webhook as the agent's own call result, or null when it isn't ours or isn't one
// to act on (call_ended comes first, without the analysis).
export function callResultOf(payload: {
  event?: unknown;
  call?: RetellCall;
}): { token: string; result: CallResult } | null {
  if (payload.event !== "call_analyzed" || !payload.call) return null;
  const { call } = payload;
  const token = call.metadata?.token;
  if (typeof token !== "string" || !token) return null;
  const analysis = call.call_analysis?.custom_analysis_data ?? {};
  const said = analysis.outcome as CallOutcome;
  const outcome: CallOutcome = NOT_REACHED.includes(String(call.disconnection_reason))
    ? "no_answer"
    : CALL_OUTCOMES.includes(said)
      ? said
      : "needs_person";
  const cents = analysis.new_monthly_cents;
  return {
    token,
    result: {
      outcome,
      transcript: typeof call.transcript === "string" ? call.transcript : "",
      newMonthlyCents: outcome === "lowered" && Number.isInteger(cents) ? (cents as number) : null,
      offer: outcome === "offer" && typeof analysis.offer === "string" ? analysis.offer : null,
    },
  };
}
