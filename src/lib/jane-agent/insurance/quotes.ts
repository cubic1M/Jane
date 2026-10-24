import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { QUOTABLE_KINDS } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { kindWords } from "@/lib/insurance/gaps";
import { quotesFor, requestQuotes, type QuotesResult } from "@/lib/insurance/quotes";
import { shopNow } from "@/lib/insurance/shop";
import { shopCard } from "@/lib/insurance/shop-card";
import { OPTION_ACTIONS } from "../actions/options";
import { shopBody } from "../sources/insurance";
import { formatCents } from "@/lib/money";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";
import type { InsuranceIntent } from "./intents";
import { loadInsuranceSnapshot } from "./snapshot";

// Quotes in Jane's chat (spec step 103): "find me cheaper car insurance" asks the insurance
// partner for quotes with the same cover and deductible, and says what came back, like for
// like. Asking commits to nothing; buying is a tap later (spec step 105).

const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});

// Shown up to this many quotes in the chat; the rest are on the quotes page.
const SHOWN = 3;

// Pure: the reply for what the partner said.
export function quotesReply(result: QuotesResult): Reply {
  if (result.kind === "unavailable") {
    const body =
      result.reason === "no_partner"
        ? "I can't get insurance quotes for you yet: that needs a licensed insurance partner, which isn't connected. I'll keep an eye on your renewal date meanwhile."
        : result.reason === "not_quotable"
          ? "I can only get quotes for car, home, renters, life and pet insurance for now."
          : "I couldn't find that policy on your insurance.";
    return { body, actions: [link("See your insurance", "/insurance")], refs: {} };
  }
  const { policy, quotes, currentAnnualCents } = result;
  const href = `/insurance/quotes?policy=${policy.id}`;
  const name = `your ${policy.carrier} ${kindWords(policy.kind)}`;
  if (quotes.length === 0) {
    return {
      body: `No carrier quoted ${name} this time.`,
      actions: [link("See your insurance", "/insurance")],
      refs: { policyId: policy.id },
    };
  }
  if (policy.kind === "health") return healthReply(result, href, name);
  const demo = quotes.some((q) => q.demo);
  const lines = quotes.slice(0, SHOWN).map((q) => {
    const saving = currentAnnualCents === null ? 0 : currentAnnualCents - q.annualPremiumCents;
    const vs =
      currentAnnualCents === null
        ? ""
        : saving > 0
          ? `, ${formatCents(saving)} less`
          : saving < 0
            ? `, ${formatCents(-saving)} more`
            : ", the same";
    const cover = q.sameCover ? "same cover" : `not the same cover: ${q.differences.join("; ")}`;
    return `- ${q.carrier.name}, rated ${q.carrier.rating}: ${formatCents(q.premiumCents)} ${PREMIUM_FREQUENCIES[q.premiumFrequency].label} (${formatCents(q.annualPremiumCents)} a year${vs}), ${cover}`;
  });
  // The answer first: the lowest price for the same cover, or that none has it.
  const best = quotes.find((q) => q.sameCover);
  const bestSaving =
    best && currentAnnualCents !== null ? currentAnnualCents - best.annualPremiumCents : null;
  const headline = best
    ? `The lowest price for the same cover as ${name} is ${best.carrier.name}, at ${formatCents(best.annualPremiumCents)} a year${bestSaving !== null && bestSaving > 0 ? `, ${formatCents(bestSaving)} less than you pay now` : ""}.`
    : `None of the ${quotes.length === 1 ? "quote" : `${quotes.length} quotes`} for ${name} has quite the same cover, so check the differences.`;
  return {
    body: [
      headline,
      ...lines,
      ...(quotes.length > SHOWN ? [`And ${quotes.length - SHOWN} more on the quotes page.`] : []),
      ...(demo ? ["These are sample quotes from my demo carrier catalog, not real offers."] : []),
      "Nothing changes unless you say so.",
    ].join("\n"),
    actions: [link("See the quotes", href)],
    refs: { policyId: policy.id },
  };
}

// Spec step 149: health plans by what they'd cost in a year with the usual care.
function healthReply(
  result: Extract<QuotesResult, { kind: "quotes" }>,
  href: string,
  name: string,
): Reply {
  const plans = result.quotes
    .filter((q) => q.expectedCostCents !== null)
    .sort((a, b) => a.expectedCostCents! - b.expectedCostCents!);
  const [best] = plans;
  const current = result.currentTotalCents ?? null;
  const saving = best && current !== null ? current - best.expectedCostCents! : null;
  const headline = best
    ? `With your usual care, the plan that would cost least in a year is ${best.plan ?? best.carrier.name}, at about ${formatCents(best.expectedCostCents!)}${saving !== null && saving > 0 ? `, ${formatCents(saving)} less than ${name}` : ""}.`
    : `I couldn't work out a yearly cost for the plans offered for ${name}.`;
  return {
    body: [
      headline,
      ...plans
        .slice(0, SHOWN)
        .map(
          (q) =>
            `- ${q.plan ?? q.carrier.name}: ${formatCents(q.premiumCents)} ${PREMIUM_FREQUENCIES[q.premiumFrequency].label}, deductible ${formatCents(q.deductibleCents ?? 0)}, about ${formatCents(q.expectedCostCents!)} a year with your usual care`,
        ),
      ...(current === null
        ? [`Add your plan's deductible, your share and its yearly most so I can compare it too.`]
        : []),
      ...(plans.some((q) => q.demo)
        ? ["These are sample plans from my demo marketplace, not real offers."]
        : []),
      "Nothing changes unless you say so.",
    ].join("\n"),
    actions: [{ id: "open", label: "See the plans", kind: "link", href }],
    refs: { policyId: result.policy.id },
  };
}

// Which policy the person means: the one of the kind they named, or their only one the
// partner can quote.
export async function quotesAnswer(
  userId: string,
  intent: InsuranceIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const { policies, shopsItself } = await loadInsuranceSnapshot(userId, { client, now });
  const candidates = policies.filter(
    (p) =>
      p.status === "active" &&
      QUOTABLE_KINDS.includes(p.kind) &&
      (!intent.policyKind || p.kind === intent.policyKind),
  );
  if (candidates.length !== 1) {
    return {
      body:
        candidates.length === 0
          ? intent.policyKind
            ? `I don't have ${kindWords(intent.policyKind)} on file to get quotes for. Add it and I'll compare it.`
            : "I don't have a policy on file I can get quotes for. Add your car, home, renters, life or pet policy first."
          : `Which one? You have ${candidates.map((p) => `${p.carrier} ${kindWords(p.kind)}`).join(" and ")}. Ask about one, like "find me cheaper ${kindWords(candidates[0].kind)}".`,
      actions: [link("See your insurance", "/insurance")],
      refs: {},
    };
  }
  const [policy] = candidates;
  // Spec step 104: in demo advice mode Jane shops it, with her pick and why.
  if (shopsItself) {
    const shop = await shopNow(userId, policy.id, { client, now });
    if (shop?.status === "open") {
      const body = shopBody(shop, policies, null, true);
      // The quotes as the pick-one card over the chat (Jane's pick first, the other cheaper
      // ones after): a tap on any of them switches (option.pick, through acceptShop).
      const card = shopCard(shop, policy);
      if (body && card) {
        return {
          body,
          actions: [
            ...OPTION_ACTIONS,
            link("Show options", `/insurance/quotes?policy=${policy.id}`),
          ],
          refs: { insuranceShopId: shop.id, policyId: policy.id, advice: true, options: card },
        };
      }
    }
    if (shop?.status === "no_better") {
      const reply = quotesReply({
        kind: "quotes",
        policy,
        currentAnnualCents: shop.currentAnnualCents,
        quotes: await quotesFor(userId, policy.id, { client, now }),
      });
      return {
        ...reply,
        body: reply.body.replace(
          "Nothing changes unless you say so.",
          "None with the same cover saves enough to be worth switching, so I'd keep what you have.",
        ),
        refs: { ...reply.refs, advice: true },
      };
    }
  }
  return quotesReply(await requestQuotes(userId, policy.id, { client, now }));
}
