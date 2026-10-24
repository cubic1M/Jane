import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { POLICY_KINDS, type CoverEvent } from "@/config/insurance";
import type { CoverChange } from "@/lib/insurance/cover-changes";
import type { Policy } from "@/lib/insurance/policies";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Cover changes after a life event in Jane's chat (spec step 154): the event, the changes
// Jane prepared, and one tap to make them (or Done, when the person makes them with their
// insurer themselves). Pure.

export const EVENT_INTRO: Record<CoverEvent, string> = {
  car_bought: "You've got a new car.",
  moving: "You're moving.",
  new_baby: "Congratulations on the baby!",
  married: "Congratulations on getting married!",
  new_job: "Congrats on the new job!",
};

type PolicyLike = Pick<Policy, "id" | "carrier" | "kind" | "premiumCents" | "premiumFrequency">;

const policyName = (policy: PolicyLike | undefined) =>
  policy ? `${policy.carrier} ${POLICY_KINDS[policy.kind].toLowerCase()} policy` : "policy";

// Pure: one change in words.
export function changeLine(change: CoverChange, policy: PolicyLike | undefined): string {
  switch (change.change) {
    case "address":
      return `Update the address on your ${policyName(policy)} (the price stays the same)`;
    case "add_vehicle":
      return `Add ${change.detail.vehicle ?? "the new car"} to your ${policyName(policy)}`;
    case "add_spouse":
      return `Add your spouse to your ${policyName(policy)}`;
    case "add_dependant":
      return `Add the baby to your ${policyName(policy)}`;
    case "review_life":
      return "Check your life cover is still enough";
    case "review_benefits":
      return "Look over the benefits at your new job before the sign-up deadline";
    case "get_auto":
      return "Get car insurance before you drive it";
  }
}

export const coverEventRef = (event: CoverEvent, eventKey: string) => `${event}|${eventKey}`;

export function parseCoverEventRef(ref: string | undefined) {
  const [event, ...rest] = (ref ?? "").split("|");
  return event && rest.length > 0 ? { event: event as CoverEvent, eventKey: rest.join("|") } : null;
}

// Pure: the message asking once. With a partner, Jane makes the changes on the tap; without
// one, the person tells their insurers and taps Done.
export function coverBody(
  event: CoverEvent,
  changes: CoverChange[],
  policies: PolicyLike[],
  withPartner: boolean,
): string {
  const byId = new Map(policies.map((p) => [p.id, p]));
  const carrierChanges = changes.some((c) =>
    ["address", "add_vehicle", "add_spouse", "add_dependant"].includes(c.change),
  );
  return [
    `${EVENT_INTRO[event]} Here's what I've got ready for your insurance:`,
    ...changes.map((c) => `- ${changeLine(c, c.policyId ? byId.get(c.policyId) : undefined)}`),
    carrierChanges
      ? withPartner
        ? "I'll make these with your insurers when you say so, and tell you any new price."
        : "Tell your insurers about these, then tap Done so I keep your insurance up to date."
      : "Tap OK and I'll start on these.",
  ].join("\n");
}

export const CHANGES_LINK: MessageAction = {
  id: "open",
  label: "Your insurance",
  kind: "link",
  href: "/insurance?focus=changes",
};

export function coverActions(changes: CoverChange[], withPartner: boolean): MessageAction[] {
  const carrierChanges = changes.some((c) =>
    ["address", "add_vehicle", "add_spouse", "add_dependant"].includes(c.change),
  );
  return [
    {
      id: "cover.apply",
      label: carrierChanges ? (withPartner ? "Make the changes" : "Done") : "OK",
      kind: "primary",
    },
    { id: "cover.dismiss", label: "Not now", kind: "secondary" },
    CHANGES_LINK,
  ];
}

// Pure: what was made, with any new price.
export function doneNote(made: CoverChange[], policies: PolicyLike[]): string {
  const byId = new Map(policies.map((p) => [p.id, p]));
  const priced = made.flatMap((c) => {
    const policy = c.policyId ? byId.get(c.policyId) : undefined;
    if (!policy || c.newPremiumCents === null || c.newPremiumCents === policy.premiumCents) {
      return [];
    }
    const per = policy.premiumFrequency ? PREMIUM_FREQUENCIES[policy.premiumFrequency].label : "";
    return [`your ${policyName(policy)} is now ${formatCents(c.newPremiumCents)} ${per}`.trim()];
  });
  const life = made.some((c) => c.change === "review_life");
  return [
    "Done.",
    ...(priced.length > 0 ? [`${priced.join("; ")}.`.replace(/^./, (x) => x.toUpperCase())] : []),
    ...(life ? ["I'll check your life cover next."] : []),
  ].join(" ");
}
