import { CHANGES_IN_REPLY } from "@/config/changes";
import type { ChangeView } from "@/lib/changes";
import type { FindingType } from "@/generated/prisma/client";
import type { Reply } from "./replies";

// What Jane offers to do about a change, and says she did, for each finding a change can
// lead to (src/lib/changes.ts). `yes` names the button that says yes, when "Look into it"
// would undersell it.
export const CHANGE_ASK: Partial<
  Record<FindingType, { offer: string; did: string; yes?: string }>
> = {
  price_increase: {
    offer: "Want me to ask them for your old price?",
    did: "I've already asked them for your old price.",
  },
  insurance_reshop: {
    offer: "Want me to shop it for a better price?",
    did: "I'm shopping it for a better price.",
  },
  bill_negotiation: {
    offer: "Want me to try to get it lowered?",
    did: "I'm working on getting it lowered.",
  },
  bank_fees: { offer: "Want me to ask for it back?", did: "I've already asked for it back." },
  // A new subscription and its subscription card, said once (docs/feature-audit.md, cluster 10).
  subscription_review: {
    offer: "Did you mean to sign up? If not, I can cancel it.",
    did: "I'm cancelling it.",
    yes: "Cancel it",
  },
};

// A change in a line, with what Jane already did about it.
export function changeLine(change: ChangeView): string {
  const did = change.finding?.handledBy && CHANGE_ASK[change.finding.type]?.did;
  if (!did) return change.title;
  return `${change.title} ${did}${change.finding!.handledBy === "rule" ? " (autopilot)" : ""}`;
}

// "What changed?" (spec step 97): the changes Jane noticed lately, newest first, in the
// same words as her heads-ups.
export function changesReply(changes: ChangeView[]): Reply {
  const links = [{ id: "open", label: "See insights", kind: "link", href: "/insights" } as const];
  if (changes.length === 0) {
    return {
      body: "Nothing's changed that I'd flag. Your bills, paychecks and spending look as usual, and I'll tell you here when something moves.",
      actions: [...links],
      refs: {},
    };
  }
  const shown = changes.slice(0, CHANGES_IN_REPLY);
  const more = changes.length - shown.length;
  return {
    body: [
      `${changes.length === 1 ? "One thing" : `${changes.length} things`} changed lately.`,
      ...shown.map((c) => `- ${changeLine(c)}`),
      ...(more > 0 ? [`And ${more} more.`] : []),
    ].join("\n"),
    actions: [...links],
    refs: {},
  };
}
