import { createHash } from "node:crypto";

// Phone calls for the action agent (spec step 54). No calling service is connected yet:
// outside production a simulated call stands in, so the whole loop runs and is tested; in
// production every call goes to the team until a provider is chosen. A provider then
// places the call with the script and posts the result to POST /api/voice/result (see
// src/app/api/voice/result/route.ts for the format).

export type CallMode = "simulated" | "off";

export function callMode(): CallMode {
  return process.env.NODE_ENV === "production" ? "off" : "simulated";
}

// A made-up number in the range set aside for fiction (555-0100 to 555-0199).
export const SIMULATED_NUMBER = "+1 555 0100";

export type CallOutcome =
  // The provider lowered the price; newMonthlyCents is the new price.
  | "lowered"
  // An offer the person must accept or decline (a new plan, a contract, a fee).
  | "offer"
  | "refused"
  // The provider will only talk to the account holder.
  | "needs_person"
  | "no_answer";

export const CALL_OUTCOMES: readonly CallOutcome[] = [
  "lowered",
  "offer",
  "refused",
  "needs_person",
  "no_answer",
];

export type OfferTerms = { monthlyCents: number; contractMonths: number; feeCents: number };

export type CallResult = {
  outcome: CallOutcome;
  transcript: string;
  newMonthlyCents: number | null;
  offer: string | null;
  // For an offer: its price, contract length and one-off fee, when the provider said them.
  offerTerms?: OfferTerms | null;
};

// What the simulated provider says, the same every time for the same action.
export function simulatedCall(
  actionId: string,
  company: string,
  monthlyCents: number,
  targetCents: number,
): CallResult {
  const n = createHash("sha256").update(actionId).digest()[0] % 10;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const opening = `Jane: Hi, this call may be recorded. I'm Jane, an assistant calling for the account holder, who asked me to ask about a lower monthly price.\n${company}: Sure, let me look at the account.`;
  if (n < 5) {
    const lower = Math.max(targetCents, Math.round(monthlyCents * 0.8));
    return {
      outcome: "lowered",
      newMonthlyCents: lower,
      offer: null,
      transcript: `${opening}\n${company}: I can apply a loyalty discount: ${dollars(lower)} a month, same service, no contract.\nJane: Thank you, please apply it.\n${company}: Done.`,
    };
  }
  if (n < 7) {
    return {
      outcome: "offer",
      newMonthlyCents: null,
      offer: `${dollars(targetCents)} a month with a 12-month contract`,
      offerTerms: { monthlyCents: targetCents, contractMonths: 12, feeCents: 0 },
      transcript: `${opening}\n${company}: The best I can do is ${dollars(targetCents)} a month with a 12-month contract.\nJane: I'll check with the account holder before accepting anything.`,
    };
  }
  if (n < 8) {
    return {
      outcome: "offer",
      newMonthlyCents: null,
      offer: `${dollars(targetCents)} a month on the basic plan, no contract and no fee`,
      offerTerms: { monthlyCents: targetCents, contractMonths: 0, feeCents: 0 },
      transcript: `${opening}\n${company}: I can move you to the basic plan at ${dollars(targetCents)} a month, no contract, no fee.`,
    };
  }
  if (n < 9) {
    return {
      outcome: "refused",
      newMonthlyCents: null,
      offer: null,
      transcript: `${opening}\n${company}: I'm sorry, there are no offers on this account right now.`,
    };
  }
  return {
    outcome: "needs_person",
    newMonthlyCents: null,
    offer: null,
    transcript: `${opening}\n${company}: I need to verify the account holder directly before I can discuss the account.`,
  };
}
