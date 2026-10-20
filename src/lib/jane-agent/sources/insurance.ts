import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import type { PolicyKind } from "@/config/insurance";
import type { Shop } from "@/lib/insurance/shop";
import { formatCents } from "@/lib/money";
import { reminderDue } from "@/lib/insurance/claim-rules";
import { checkupBody } from "../insurance/checkup-words";
import { BENEFITS_LINK, QUESTIONS, foundBody } from "../insurance/benefit-words";
import { trackerActions, trackerBody } from "../insurance/claim-words";
import { readingBody, readingLink } from "../insurance/reading-words";
import { DEPENDANTS_QUESTION, sizedActions, sizedBody } from "../insurance/life-words";
import { coverActions, coverBody, coverEventRef } from "../insurance/cover-words";
import { RISK_GAP_KINDS } from "@/lib/insurance/risk-signals";
import { riskActions, riskQuestion } from "../insurance/risk-words";
import {
  deductibleActions,
  deductibleBody,
  lowering,
  sameCover,
  sameCoverActions,
  sameCoverBody,
} from "../insurance/saving-words";
import {
  ASK_CALL_ACTIONS,
  askCallBody,
  callResultBody,
  claimStatusBody,
  draftActions,
  draftBody,
} from "../insurance/done-by-jane-words";
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
      // Spec step 197: sample prices for the cover a yes to a risk question opened.
      ...(insurance.canQuote && gap.key in RISK_GAP_KINDS
        ? [{ id: "insurance.gap_quotes" as const, label: "Get quotes", kind: "primary" as const }]
        : []),
      { id: "insurance.gap_no", label: "I don't need it", kind: "secondary" },
      snoozeButton(),
    ],
    dedupeKey: `gap:${gap.key}`,
    priority: MESSAGE_PRIORITY.insurance_gap,
  }));
}

// "I found car insurance $408.00 a year cheaper for the same cover", with the pick, why in
// three lines, and what Yes does.
export function shopBody(
  shop: Shop,
  policies: Policies,
  autopilot: string | null = null,
): string | null {
  const policy = policies.find((p) => p.id === shop.policyId);
  if (!policy || !shop.pick || shop.savingCents === null) return null;
  const { pick } = shop;
  const price = `${formatCents(pick.premiumCents)} ${PREMIUM_FREQUENCIES[pick.premiumFrequency].label}`;
  return [
    // Spec step 149: health plans compare on a year's total cost with the usual care.
    policy.kind === "health"
      ? `I found a health plan that would cost ${formatCents(shop.savingCents)} less a year with your usual care: ${pick.plan ?? pick.carrier.name}, at ${price}.`
      : `I found ${kindWords(policy.kind)} ${formatCents(shop.savingCents)} a year cheaper for the same cover: ${pick.carrier.name}, at ${price}.`,
    ...shop.why.map((line) => `- ${line}`),
    ...(shop.demo
      ? ["These are sample quotes from my demo carrier catalog, not real offers."]
      : []),
    // Spec step 108: at "handle everything" the switch is ready to go.
    autopilot === "all"
      ? `It's ready: tap Yes and I'll do the rest. I buy it, confirm its first payment, then cancel ${policy.carrier} from the same day.`
      : `Say yes and I'll switch you. Your ${policy.carrier} policy stays in place until the new one is.`,
  ].join("\n");
}

function shopMessages(insurance: InsuranceSnapshot, autopilot: string | null): Candidate[] {
  return (insurance.shops ?? []).flatMap((shop): Candidate[] => {
    const body = shopBody(shop, insurance.policies, autopilot);
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

// Spec step 150: benefits found on the pay stub, to confirm in one tap; then the short guided
// questions for cover the employer pays for, one at a time in the same message.
function benefitMessages(insurance: InsuranceSnapshot): Candidate[] {
  const found = (insurance.benefits ?? []).filter((b) => b.status === "found");
  if (found.length > 0) {
    return [
      {
        kind: "decision",
        body: foundBody(found),
        refs: {},
        actions: [
          { id: "benefits.confirm_all", label: "Yes, they're right", kind: "primary" },
          { ...BENEFITS_LINK, label: "Review them" },
          snoozeButton(),
        ],
        dedupeKey: `benefits:${found.map((b) => b.id).join(",")}`,
        priority: MESSAGE_PRIORITY.benefits_found,
      },
    ];
  }
  const question = insurance.benefitQuestion;
  if (!question) return [];
  return [
    {
      kind: "decision",
      body: QUESTIONS[question].body,
      refs: { benefitQuestion: question },
      actions: [...QUESTIONS[question].actions, BENEFITS_LINK],
      dedupeKey: "benefit-questions",
      priority: MESSAGE_PRIORITY.benefits_question,
    },
  ];
}

// Spec step 151: each policy read from a document, for one Confirm tap. At every autopilot
// level Jane reads the document herself and asks; nothing is saved without the tap.
function readingMessages(insurance: InsuranceSnapshot): Candidate[] {
  return (insurance.readings ?? []).map((reading) => ({
    kind: "decision",
    body: readingBody(reading),
    refs: { readingId: reading.id },
    actions: [
      { id: "reading.confirm", label: "Confirm", kind: "primary" },
      readingLink(reading.id),
      { id: "reading.dismiss", label: "Not a policy", kind: "secondary" },
    ],
    dedupeKey: `reading:${reading.id}`,
    priority: MESSAGE_PRIORITY.policy_reading,
  }));
}

// Spec step 153 (demo advice): the dependants question, then the amount and term with the
// method and the best quote. Applying and buying happen in the same message, a tap each;
// at no autopilot level does Jane apply or buy by herself.
function lifeMessages(insurance: InsuranceSnapshot, asOf: string): Candidate[] {
  if (insurance.lifeAsk === "dependants") {
    return [
      {
        kind: "decision",
        body: DEPENDANTS_QUESTION.body,
        refs: {},
        actions: DEPENDANTS_QUESTION.actions,
        dedupeKey: "life-dependants",
        priority: MESSAGE_PRIORITY.life_dependants,
      },
    ];
  }
  const life = insurance.life;
  if (!life || life.status !== "sized" || !insurance.advice) return [];
  return [
    {
      kind: "decision",
      body: sizedBody(life, asOf),
      refs: { lifeApplicationId: life.id, advice: true },
      actions: sizedActions(life, asOf),
      dedupeKey: `life:${life.id}:${life.amountCents}:${life.termYears}`,
      priority: MESSAGE_PRIORITY.life_sized,
    },
  ];
}

// Spec step 154: one message per life event, asking once about every change it needs.
function coverChangeMessages(insurance: InsuranceSnapshot): Candidate[] {
  const groups = new Map<string, NonNullable<InsuranceSnapshot["coverChanges"]>>();
  for (const change of insurance.coverChanges ?? []) {
    const ref = coverEventRef(change.event, change.eventKey);
    groups.set(ref, [...(groups.get(ref) ?? []), change]);
  }
  return [...groups].map(([ref, changes]) => ({
    kind: "decision",
    body: coverBody(changes[0].event, changes, insurance.policies, insurance.canQuote),
    refs: { coverEvent: ref },
    actions: coverActions(changes, insurance.canQuote),
    dedupeKey: `cover:${ref}`,
    priority: MESSAGE_PRIORITY.cover_change,
  }));
}

// Spec step 155: the renewal call Jane offers to make (or made within the person's autopilot
// limits) and its result; a claim's draft to file on a tap; the carrier's news on a claim.
function doneByJaneMessages(insurance: InsuranceSnapshot): Candidate[] {
  const policyOf = (id: string | null) => insurance.policies.find((p) => p.id === id);
  const negotiations = (insurance.negotiations ?? []).map((n): Candidate =>
    n.status === "asked"
      ? {
          kind: "decision",
          body: askCallBody(n, policyOf(n.policyId)),
          refs: { negotiationId: n.id },
          actions: ASK_CALL_ACTIONS,
          dedupeKey: `renewal-call:${n.id}`,
          priority: MESSAGE_PRIORITY.renewal_call,
        }
      : {
          kind: "heads_up",
          body: callResultBody(n, policyOf(n.policyId)),
          refs: {},
          actions: [{ id: "open", label: "Your insurance", kind: "link", href: "/insurance" }],
          dedupeKey: `renewal-result:${n.id}`,
          priority: MESSAGE_PRIORITY.renewal_result,
        },
  );
  const drafts = (insurance.draftClaims ?? []).map((c): Candidate => ({
    kind: "decision",
    body: draftBody(c),
    refs: { claimId: c.id },
    actions: draftActions(c),
    dedupeKey: `claim-draft:${c.id}:${c.amountCents}`,
    priority: MESSAGE_PRIORITY.claim_draft,
  }));
  const statuses = (insurance.filedClaims ?? []).map((c): Candidate => ({
    kind: "heads_up",
    body: claimStatusBody(c),
    refs: {},
    actions: [{ id: "open", label: "Your claim", kind: "link", href: "/insurance/claims" }],
    dedupeKey: `claim-status:${c.id}:${c.carrierStatus}`,
    priority: MESSAGE_PRIORITY.claim_status,
  }));
  return [...negotiations, ...drafts, ...statuses];
}

// Spec step 196: the savings that keep the cover as it is, in one message with one tap; a
// higher deductible, which lowers the cover, on its own. Applying is always the person's tap.
function savingMessages(insurance: InsuranceSnapshot): Candidate[] {
  const savings = insurance.savings ?? [];
  const same = sameCover(savings);
  return [
    ...(same.length > 0
      ? [
          {
            kind: "decision" as const,
            body: sameCoverBody(same, insurance.policies),
            refs: { savingGroup: "same", advice: true as const },
            actions: sameCoverActions(same),
            dedupeKey: `savings:same:${same
              .map((s) => s.id)
              .sort()
              .join(",")}`,
            priority: MESSAGE_PRIORITY.saving_group,
          },
        ]
      : []),
    ...lowering(savings).map((s): Candidate => ({
      kind: "decision",
      body: deductibleBody(
        s,
        insurance.policies.find((p) => p.id === s.policyId),
      ),
      refs: { savingId: s.id, advice: true as const },
      actions: deductibleActions(),
      dedupeKey: `saving:${s.id}`,
      priority: MESSAGE_PRIORITY.saving_deductible,
    })),
  ];
}

// Spec step 197: one question about how they live, asked once; yes or no ends it.
function riskMessages(insurance: InsuranceSnapshot): Candidate[] {
  return (insurance.risks ?? []).map((risk) => ({
    kind: "decision",
    body: riskQuestion(risk),
    refs: { riskId: risk.id },
    actions: riskActions(),
    dedupeKey: `risk:${risk.id}`,
    priority: MESSAGE_PRIORITY.risk_question,
  }));
}

export const insuranceSource: MessageSource = {
  key: "insurance",
  gather: (snapshot) => {
    const insurance = snapshot.insurance;
    if (!insurance) return [];
    return [
      ...claimReminders(insurance, snapshot.asOf),
      ...shopMessages(insurance, snapshot.autopilot),
      ...switchMessages(insurance),
      ...gapMessages(insurance),
      ...checkedMessages(insurance),
      ...checkupMessages(insurance),
      ...benefitMessages(insurance),
      ...readingMessages(insurance),
      ...lifeMessages(insurance, snapshot.asOf),
      ...coverChangeMessages(insurance),
      ...doneByJaneMessages(insurance),
      ...savingMessages(insurance),
      ...riskMessages(insurance),
    ];
  },
};
