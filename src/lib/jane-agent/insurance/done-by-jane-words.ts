import { POLICY_KINDS } from "@/config/insurance";
import { STATUS_WORDS, type Claim } from "@/lib/insurance/claim-rules";
import type { Negotiation } from "@/lib/insurance/negotiate";
import type { Policy } from "@/lib/insurance/policies";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Renewal negotiation and claims, done by Jane, in her chat (spec step 155): the call she
// offers to make (or made on autopilot) and what the carrier said; a claim's draft for the
// person to check before it's filed, and the carrier's status as it moves. Pure.

type PolicyLike = Pick<Policy, "carrier" | "kind">;
const policyWords = (p: PolicyLike | undefined) =>
  p ? `${p.carrier} ${POLICY_KINDS[p.kind].toLowerCase()} policy` : "policy";

export function askCallBody(n: Negotiation, policy: PolicyLike | undefined): string {
  return [
    `Your ${policyWords(policy)} renews at ${formatCents(n.renewalAnnualCents)} a year, up from ${formatCents(n.currentAnnualCents)}. Want me to call ${policy?.carrier ?? "them"} and ask for a better rate?`,
    n.competingAnnualCents !== null && n.competingAnnualCents < n.renewalAnnualCents
      ? `I'm shopping it at the same time: the same cover is ${formatCents(n.competingAnnualCents)} a year elsewhere, which I'll mention on the call.`
      : "I'm shopping it at the same time.",
    "I'll only ask for a lower price; I won't change your cover on the call.",
  ].join("\n");
}

export const ASK_CALL_ACTIONS: MessageAction[] = [
  { id: "renewal.call", label: "Call them", kind: "primary" },
  { id: "renewal.no", label: "No thanks", kind: "secondary" },
];

// Pure: what happened on the call.
export function callResultBody(n: Negotiation, policy: PolicyLike | undefined): string {
  const carrier = policy?.carrier ?? "Your insurer";
  const who = n.calledBy === "autopilot" ? "On autopilot, I called" : "I called";
  const lines =
    n.status === "lowered" && n.resultAnnualCents !== null
      ? [
          `${who} ${carrier}: they'll renew your ${policyWords(policy)} at ${formatCents(n.resultAnnualCents)} a year instead of ${formatCents(n.renewalAnnualCents)}, the same cover. That saves ${formatCents(n.renewalAnnualCents - n.resultAnnualCents)} a year.`,
        ]
      : [
          `${who} ${carrier}: they won't go below ${formatCents(n.renewalAnnualCents)} a year for your ${policyWords(policy)}.${n.competingAnnualCents !== null && n.competingAnnualCents < n.renewalAnnualCents ? ` The same cover is ${formatCents(n.competingAnnualCents)} a year elsewhere: see the quotes.` : ""}`,
        ];
  if (n.offer)
    lines.push(`They also offered ${n.offer}. I didn't take it; tell me if you want it.`);
  return lines.join("\n");
}

// Pure: the claim as it would go, for the person's review before it's filed.
export function draftBody(claim: Claim): string {
  return [
    `Here's the claim I'd file with ${claim.carrier ?? "your insurer"}. Nothing goes until you tap File it.`,
    `- What happened: ${claim.description ?? ""}`,
    `- On: ${claim.happenedOn}`,
    `- Claiming: ${claim.amountCents ? formatCents(claim.amountCents) : "?"}`,
  ].join("\n");
}

export const draftActions = (claim: Claim): MessageAction[] => [
  { id: "claim.file", label: "File it", kind: "primary" },
  { id: "open", label: "Change it", kind: "link", href: `/insurance/claims#claim-${claim.id}` },
];

// Pure: the carrier's status, once it moves.
export function claimStatusBody(claim: Claim): string {
  const status = claim.carrierStatus ?? "received";
  const payout =
    (status === "approved" || status === "paid") && claim.payoutCents !== null
      ? status === "paid"
        ? ` They paid ${formatCents(claim.payoutCents ?? 0)}, so I've closed the claim.`
        : ` They'll pay ${formatCents(claim.payoutCents ?? 0)}, after your deductible.`
      : "";
  return `${claim.carrier ?? "Your insurer"} ${STATUS_WORDS[status]} (number ${claim.claimNumber ?? "pending"}).${payout}`;
}
