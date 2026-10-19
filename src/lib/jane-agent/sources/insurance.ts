import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import type { PolicyKind } from "@/config/insurance";
import type { Shop } from "@/lib/insurance/shop";
import { formatCents } from "@/lib/money";
import { reminderDue } from "@/lib/insurance/claim-rules";
import { checkupBody } from "../insurance/checkup-words";
import { trackerActions, trackerBody } from "../insurance/claim-words";
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

// Spec step 105: what Jane did after the Yes. "Bound, starts on …" once, and "switched, no
// gap in cover" once the first payment went through and the old policy was cancelled.
function switchMessages(insurance: InsuranceSnapshot): Candidate[] {
  return (insurance.switches ?? []).flatMap((sw): Candidate[] => {
    const name = `${sw.carrier} ${kindWords(sw.kind as PolicyKind)}`;
    const starts = sw.startsOn ? shortDate(sw.startsOn) : "soon";
    const open = {
      id: "open",
      label: "See your insurance",
      kind: "link",
      href: "/insurance",
    } as const;
    if (sw.status === "pending") {
      return [
        {
          kind: "done",
          body: `I've bought your new ${name}, starting ${starts}. ${sw.replaces ?? "Your old policy"} stays in place until its first payment goes through; then I cancel it from the same day, so you're never without cover.`,
          refs: { policyId: sw.policyId, ...(sw.actionId ? { actionId: sw.actionId } : {}) },
          actions: [open],
          dedupeKey: `bound:${sw.policyId}`,
          priority: MESSAGE_PRIORITY.insurance_checked,
        },
      ];
    }
    return [
      {
        kind: "done",
        body: `Your switch is done: the first payment to ${sw.carrier} went through, so your new ${kindWords(sw.kind as PolicyKind)} is in place${sw.replaces ? ` and I cancelled ${sw.replaces} from ${starts}` : ""}. No gap in cover.`,
        refs: { policyId: sw.policyId, ...(sw.actionId ? { actionId: sw.actionId } : {}) },
        actions: [open],
        dedupeKey: `switched:${sw.policyId}`,
        priority: MESSAGE_PRIORITY.insurance_checked,
      },
    ];
  });
}

// Spec step 106: the coverage checkup Jane ran by herself (demo advice): the top
// recommendations with what each costs and the risk it changes, or "nothing to change".
function checkupMessages(insurance: InsuranceSnapshot): Candidate[] {
  const checkup = insurance.checkup;
  if (!checkup) return [];
  return [
    {
      kind: checkup.recommendations.length === 0 ? "done" : "heads_up",
      body: checkupBody(checkup),
      refs: { insuranceCheckupId: checkup.id, advice: true },
      actions: [
        { id: "insurance.checkup_seen", label: "Got it", kind: "secondary" },
        { id: "open", label: "See the checkup", kind: "link", href: "/insurance/checkup" },
      ],
      dedupeKey: `checkup:${checkup.id}`,
      priority: MESSAGE_PRIORITY.insurance_checkup,
    },
  ];
}

// Spec step 107: a claim's next step, once it's due and every few days while it waits, with
// Done right there. Jane reminds; the person files.
function claimReminders(insurance: InsuranceSnapshot, asOf: string): Candidate[] {
  return (insurance.claims ?? []).flatMap((claim): Candidate[] => {
    const due = reminderDue(claim, asOf);
    if (!due) return [];
    return [
      {
        kind: "heads_up",
        body: `A reminder for your claim: ${trackerBody(claim)}`,
        refs: { claimId: claim.id, claimStep: due.step.key },
        actions: trackerActions(claim),
        dedupeKey: `claim:${claim.id}:${due.step.key}:${due.round}`,
        priority: MESSAGE_PRIORITY.insurance_claim,
      },
    ];
  });
}

export const insuranceSource: MessageSource = {
  key: "insurance",
  gather: (snapshot) => {
    const insurance = snapshot.insurance;
    if (!insurance) return [];
    return [
      ...claimReminders(insurance, snapshot.asOf),
      ...shopMessages(insurance),
      ...switchMessages(insurance),
      ...gapMessages(insurance),
      ...checkedMessages(insurance),
      ...checkupMessages(insurance),
    ];
  },
};
