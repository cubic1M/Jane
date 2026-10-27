import { UMBRELLA_ASSETS_CENTS, type PolicyKind } from "@/config/insurance";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import { formatCents } from "@/lib/money";
import type { Reply } from "../replies";
import type { InsuranceSnapshot } from "./snapshot";

// "Do I need umbrella insurance?" (spec step 149), answered from the person's numbers: what
// they have, the gap rule's reason, or why the rule doesn't fire for them. What to add is
// demo advice, only in demo advice mode and labelled. Pure.

const SEE = { id: "open", label: "See your insurance", kind: "link", href: "/insurance" } as const;

// Why a kind of cover doesn't look needed from what Jane can see.
function noGapWords(kind: PolicyKind, profile: Pick<InsuranceSnapshot, "household">): string {
  const { signals, pets, dependants } = profile.household;
  switch (kind) {
    case "umbrella":
      return signals.assetsCents === null
        ? `An umbrella policy pays above your car and home liability limits. It usually matters once what someone has is worth more than ${formatCents(UMBRELLA_ASSETS_CENTS)}; I can't see your balances yet.`
        : `An umbrella policy pays above your car and home liability limits. It usually matters once what someone has is worth more than ${formatCents(UMBRELLA_ASSETS_CENTS)}; by your balances and values, yours is about ${formatCents(signals.assetsCents)}.`;
    case "disability":
      return "Disability insurance replaces pay if an illness or injury stops you working. I don't see a paycheck in your accounts lately; if you do earn, tell me on the insurance page.";
    case "health":
      return "Health insurance pays for care above what you pay yourself. I can't see enough of your accounts yet to say more.";
    case "pet":
      return (pets.value ?? 0) > 0
        ? "Pet insurance pays vet bills after a deductible."
        : "Pet insurance pays vet bills. You haven't told me about any pets; add them on the insurance page if you have some.";
    case "travel":
      return "Travel insurance covers a trip's non-refundable cost and care abroad. I don't see a big trip booked lately, and your card may already cover some of it.";
    case "device":
      return "Device protection pays to fix or replace a phone or laptop. Many cards already cover a phone when you pay its bill with them, so check that first.";
    case "life":
      return (dependants.value ?? 0) > 0
        ? "Life insurance pays the people who depend on you if you die."
        : "Life insurance pays the people who depend on you if you die. You haven't told me anyone depends on you; if someone does, tell me and I'll look again.";
    default:
      return `I don't see a reason for ${kindWords(kind)} in your accounts. If something has changed, tell me on the insurance page.`;
  }
}

export function needReply(kind: PolicyKind, profile: InsuranceSnapshot | undefined): Reply {
  if (!profile) {
    return {
      body: `I can't see enough of your accounts yet to say whether you need ${kindWords(kind)}.`,
      actions: [SEE],
      refs: {},
    };
  }
  const has = profile.policies.filter(
    (p) => p.kind === kind && (p.status === "active" || p.status === "pending"),
  );
  if (has.length > 0) {
    return {
      body: `You already have ${has.map((p) => `${p.carrier} ${kindWords(p.kind)}`).join(" and ")}. Ask me what it covers, or whether it's priced well.`,
      actions: [SEE],
      refs: { policyId: has[0].id },
    };
  }
  const gap = profile.gaps.find((g) => g.kind === kind && !g.policyId);
  if (gap) {
    return {
      body: `${gap.title}. ${gap.why}${profile.advice ? `\n${gapAdvice(gap).text}` : ""}`,
      actions: [
        {
          id: "open",
          label: `Add ${kindWords(kind)}`,
          kind: "link",
          href: `/insurance?add=${kind}#add`,
        },
        SEE,
      ],
      refs: { insuranceGap: gap.key, ...(profile.advice ? { advice: true as const } : {}) },
    };
  }
  return {
    body: `${noGapWords(kind, profile)}${profile.advice ? "\nFrom your numbers, it can wait for now." : ""}`,
    actions: [SEE],
    refs: profile.advice ? { advice: true } : {},
  };
}
