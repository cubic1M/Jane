import { DIY_KITS } from "@/config/diy";
import type { ActionType, FindingType } from "@/generated/prisma/client";
import { draftPayload, type DraftPayload } from "./drafts";

// A do-it-yourself kit: the merchant's link, steps, and an email (as a mailto link) or a
// call script, written in the person's own voice. Built from the same privacy-safe facts
// as the team's drafts; it's the person's own mail app, but there's still no reason to
// put more in it than the merchant needs.

export type KitMerchant = { name: string; cancelUrl: string | null; supportUrl: string | null };

export type Kit = {
  link: { label: string; url: string } | null;
  steps: string[];
  email: { subject: string; body: string; mailto: string } | null;
  script: string[] | null;
};

export const hasKit = (actionType: ActionType) => Boolean(DIY_KITS[actionType]);

function chargeLines(payload: DraftPayload): string {
  return payload.charges
    .map((c) => `- ${c.date}: ${c.amount}${c.kind ? ` (${c.kind})` : ""}`)
    .join("\n");
}

function email(actionType: ActionType, findingType: FindingType, p: DraftPayload) {
  const merchant = p.facts.merchant ?? "your company";
  const charges = chargeLines(p);
  switch (actionType) {
    case "cancel_subscription":
      return {
        subject: "Please cancel my subscription",
        body: `Hello,\n\nPlease cancel my ${merchant} subscription${p.facts.latestCharge ? ` (most recently charged ${p.facts.latestCharge})` : ""} and confirm the cancellation by email.\n\nThank you,`,
      };
    case "fight_price_increase":
      return {
        subject: "Question about my new price",
        body: `Hello,\n\nMy ${merchant} price went up${p.facts.previousPrice && p.facts.latestCharge ? ` from ${p.facts.previousPrice} to ${p.facts.latestCharge}` : ""}. Could you keep my previous price, or offer a cheaper plan with the same service?\n\nThank you,`,
      };
    case "request_refund": {
      const why =
        findingType === "duplicate_charge"
          ? "I was charged twice for one purchase"
          : findingType === "charge_after_cancel"
            ? `I cancelled${p.facts.cancelledOn ? ` on ${p.facts.cancelledOn}` : ""} but was still charged`
            : "a free trial turned into a charge I didn't mean to keep";
      return {
        subject: "Refund request",
        body: `Hello,\n\nPlease refund the following charges from ${merchant}; ${why}.\n\n${charges}\n\nThank you,`,
      };
    }
    case "recover_bank_fees":
      return {
        subject: "Request to refund fees",
        body: `Hello,\n\nI was charged these fees on my account:\n\n${charges}\n\nCould you refund them as a courtesy?\n\nThank you,`,
      };
    default:
      return null;
  }
}

function script(p: DraftPayload): string[] {
  const merchant = p.facts.merchant ?? "your company";
  return [
    `Hi, I'd like to talk about my ${merchant} bill${p.facts.perMonth ? `, which is about ${p.facts.perMonth} a month` : ""}.`,
    "That's more than similar plans cost, and I'm looking at other providers.",
    "Is there a loyalty discount, a current promotion, or a cheaper plan with the same service?",
    "What would the new monthly price be, for how long, and is there a contract or any fee?",
  ];
}

export function buildKit(
  actionType: ActionType,
  finding: { type: FindingType; evidence: unknown },
  merchant: KitMerchant | null,
): Kit | null {
  const config = DIY_KITS[actionType];
  const prepared = draftPayload(actionType, finding);
  if (!config || !prepared) return null;

  const url =
    config.link === "cancel" ? (merchant?.cancelUrl ?? merchant?.supportUrl) : merchant?.supportUrl;
  const name = merchant?.name ?? prepared.payload.facts.merchant ?? "the company";
  const link = url
    ? {
        label:
          config.link === "cancel" && merchant?.cancelUrl
            ? `Open ${name}'s account page`
            : `${name} support`,
        url,
      }
    : null;

  const message =
    config.message === "email" ? email(actionType, finding.type, prepared.payload) : null;
  return {
    link,
    steps: config.steps,
    email: message
      ? {
          ...message,
          mailto: `mailto:?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`,
        }
      : null,
    script: config.message === "call" ? script(prepared.payload) : null,
  };
}
