import { CLAIM_CONTACT_FALLBACK } from "@/config/claims";
import type { PolicyKind } from "@/config/insurance";
import { eventLabel, guideFor, nextStep, type Claim } from "@/lib/insurance/claim-rules";
import { kindWords } from "@/lib/insurance/gaps";
import type { MessageAction } from "../types";
import { dayLabel } from "@/lib/day-label";

// The claims helper's words in Jane's chat (spec step 107). Pure. The guide comes first
// (what to do now, what to collect, who to call); then the same message becomes the claim's
// tracker, one step at a time.

const contactLine = (carrier: string | null, phone: string | null, url: string | null) =>
  carrier
    ? phone
      ? `Your insurer: ${carrier}, claims line ${phone}${url ? `, or online at ${url}` : ""}.`
      : `Your insurer: ${carrier}. ${CLAIM_CONTACT_FALLBACK}`
    : CLAIM_CONTACT_FALLBACK;

export function guideBody(
  kind: PolicyKind,
  event: string,
  policy: { carrier: string; kind: PolicyKind } | null,
  contact: { phone: string | null; url: string | null },
): string {
  const guide = guideFor(kind);
  return [
    `I'm sorry: ${eventLabel(kind, event).toLowerCase()}. Here's what to do now:`,
    ...guide.now.map((line) => `- ${line}`),
    "What to collect for the claim:",
    ...guide.collect.map((line) => `- ${line}`),
    policy
      ? `${contactLine(policy.carrier, contact.phone, contact.url)} It's on your ${kindWords(policy.kind)}.`
      : contactLine(null, null, null),
    "I can keep a tracker for the claim and remind you of each step.",
  ].join("\n");
}

export function trackerBody(claim: Claim): string {
  const done = claim.steps.filter((s) => s.doneAt).length;
  const what = `${eventLabel(claim.kind, claim.event).toLowerCase()} on ${dayLabel(claim.happenedOn)}`;
  const on = claim.carrier ? ` with ${claim.carrier}` : "";
  const next = nextStep(claim);
  const lines = [`Your claim tracker${on}: ${what}. ${done} of ${claim.steps.length} steps done.`];
  if (claim.status === "closed") lines.push("The claim is closed.");
  else if (next) lines.push(`Next: ${next.label} (by ${dayLabel(next.dueOn)}).`);
  else lines.push("Every step is done. Close the claim once you've been paid.");
  if (claim.claimNumber) lines.push(`Claim number: ${claim.claimNumber}.`);
  return lines.join("\n");
}

export function trackerActions(claim: Claim): MessageAction[] {
  const open: MessageAction = {
    id: "open",
    label: "See the claim",
    kind: "link",
    href: `/insurance/claims#claim-${claim.id}`,
  };
  if (claim.status === "closed") return [open];
  const next = nextStep(claim);
  return next
    ? [{ id: "insurance.claim_step", label: "Done", kind: "primary" }, open]
    : [{ id: "insurance.claim_close", label: "Close the claim", kind: "primary" }, open];
}
