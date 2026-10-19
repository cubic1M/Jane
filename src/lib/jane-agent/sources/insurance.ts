import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import type { Shop } from "@/lib/insurance/shop";
import { formatCents } from "@/lib/money";
import type { InsuranceSnapshot } from "../insurance/snapshot";
import type { Candidate } from "../types";
import { shortDate, snoozeButton, type MessageSource } from "./source";

// Insurance (spec Phase X).
// - Step 102: cover that looks missing, as a heads-up, once per gap: "I have this" opens the
//   add form for that kind, "I don't need it" never brings it up again, "Not now" until
//   tomorrow. In demo advice mode (spec step 98) she also says what to add, labelled.
// - Step 104: what Jane's own reshops found. A cheaper policy for the same cover asks once,
//   with Yes, Show options and Not now; a reshop that found nothing better says so. Jane
//   never buys cover without the Yes.

type Policies = InsuranceSnapshot["policies"];

function gapMessages(insurance: InsuranceSnapshot): Candidate[] {
  return (insurance.gaps ?? []).map((gap) => ({
    kind: "heads_up",
    body: `${gap.title}. ${gap.why}${insurance.advice ? `\n${gapAdvice(gap).text}` : ""}`,
    refs: {
      insuranceGap: gap.key,
      ...(gap.policyId ? { policyId: gap.policyId } : {}),
      ...(insurance.advice ? { advice: true as const } : {}),
    },
    actions: [
      gap.policyId
        ? {
            id: "open",
            label: "Update the policy",
            kind: "link",
            href: `/insurance?edit=${gap.policyId}#policy-${gap.policyId}`,
          }
        : {
            id: "open",
            label: `I have ${kindWords(gap.kind)}`,
            kind: "link",
            href: `/insurance?add=${gap.kind}#add`,
          },
      { id: "insurance.gap_no", label: "I don't need it", kind: "secondary" },
      snoozeButton(),
    ],
    dedupeKey: `gap:${gap.key}`,
    priority: MESSAGE_PRIORITY.insurance_gap,
  }));
}

// "I found car insurance $408.00 a year cheaper for the same cover", with the pick, why in
// three lines, and what Yes does.
export function shopBody(shop: Shop, policies: Policies): string | null {
  const policy = policies.find((p) => p.id === shop.policyId);
  if (!policy || !shop.pick || shop.savingCents === null) return null;
  const { pick } = shop;
  return [
    `I found ${kindWords(policy.kind)} ${formatCents(shop.savingCents)} a year cheaper for the same cover: ${pick.carrier.name}, at ${formatCents(pick.premiumCents)} ${PREMIUM_FREQUENCIES[pick.premiumFrequency].label}.`,
    ...shop.why.map((line) => `- ${line}`),
    ...(shop.demo
      ? ["These are sample quotes from my demo carrier catalog, not real offers."]
      : []),
    `Say yes and I'll switch you. Your ${policy.carrier} policy stays in place until the new one is.`,
  ].join("\n");
}

function shopMessages(insurance: InsuranceSnapshot): Candidate[] {
  return (insurance.shops ?? []).flatMap((shop): Candidate[] => {
    const body = shopBody(shop, insurance.policies);
    if (!body) return [];
    return [
      {
        kind: "decision",
        body,
        // Picking a policy is demo advice (spec step 98): shops exist only in that mode.
        refs: { insuranceShopId: shop.id, policyId: shop.policyId, advice: true },
        actions: [
          { id: "insurance.shop_yes", label: "Yes, switch", kind: "primary" },
          {
            id: "open",
            label: "Show options",
            kind: "link",
            href: `/insurance/quotes?policy=${shop.policyId}`,
          },
          { id: "insurance.shop_no", label: "Not now", kind: "secondary" },
        ],
        dedupeKey: `shop:${shop.id}`,
        priority: MESSAGE_PRIORITY.insurance_shop,
      },
    ];
  });
}

function checkedMessages(insurance: InsuranceSnapshot): Candidate[] {
  return (insurance.noBetter ?? []).flatMap((shop): Candidate[] => {
    const policy = insurance.policies.find((p) => p.id === shop.policyId);
    if (!policy) return [];
    const why =
      shop.reason === "price_up"
        ? "after its price went up"
        : policy.nextRenewal
          ? `before it renews on ${shortDate(policy.nextRenewal)}`
          : "before it renews";
    return [
      {
        kind: "done",
        body: `I shopped your ${policy.carrier} ${kindWords(policy.kind)} ${why}: of ${shop.quoteCount === 1 ? "1 quote" : `${shop.quoteCount} quotes`}, nothing with the same cover saved enough to switch. I'll look again next time.`,
        refs: { insuranceShopId: shop.id, policyId: policy.id },
        actions: [
          {
            id: "open",
            label: "See the quotes",
            kind: "link",
            href: `/insurance/quotes?policy=${policy.id}`,
          },
        ],
        dedupeKey: `checked:${shop.id}`,
        priority: MESSAGE_PRIORITY.insurance_checked,
      },
    ];
  });
}

export const insuranceSource: MessageSource = {
  key: "insurance",
  gather: (snapshot) => {
    const insurance = snapshot.insurance;
    if (!insurance) return [];
    return [...shopMessages(insurance), ...gapMessages(insurance), ...checkedMessages(insurance)];
  },
};
