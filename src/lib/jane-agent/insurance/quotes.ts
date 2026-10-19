import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { QUOTABLE_KINDS } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { kindWords } from "@/lib/insurance/gaps";
import { requestQuotes, type QuotesResult } from "@/lib/insurance/quotes";
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
  return {
    body: [
      `I asked for quotes with the same cover and deductible as ${name}${currentAnnualCents === null ? "" : `, which costs ${formatCents(currentAnnualCents)} a year`}:`,
      ...lines,
      ...(quotes.length > SHOWN ? [`And ${quotes.length - SHOWN} more on the quotes page.`] : []),
      ...(demo ? ["These are sample quotes from my demo carrier catalog, not real offers."] : []),
      "Nothing changes unless you say so.",
    ].join("\n"),
    actions: [link("See the quotes", href)],
    refs: { policyId: policy.id },
  };
}

// Which policy the person means: the one of the kind they named, or their only one the
// partner can quote.
export async function quotesAnswer(
  userId: string,
  intent: InsuranceIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const { policies } = await loadInsuranceSnapshot(userId, { client, now });
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
  return quotesReply(await requestQuotes(userId, candidates[0].id, { client, now }));
}
