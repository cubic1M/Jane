import { INSURANCE_CATEGORIES } from "@/config/detection";
import { insurerName } from "@/insights/found-policies";
import { formatCents } from "@/lib/money";
import { inList } from "../helpers";
import { coveringCard } from "./covered-by-card";
import { streamEvidence, type Rule } from "./rule";

// A recurring insurance payment. No dollar estimate until a partner quote exists; the card
// says "could be lower, get quotes". A plan a card already covers is raised as that
// instead (spec step 152), not reshopped. A known insurer goes by its name, not the bank's
// line ("STATE FARM RO 27 DES:CPC-CLIENT" is State Farm, not "State Farm Ro 27").
export const insuranceReshop: Rule = (input, streams) => {
  const found = streams.filter(
    (s) =>
      s.active && inList(s.pfcDetailed, INSURANCE_CATEGORIES) && !coveringCard(s, input, streams),
  );
  const nameOf = (s: (typeof found)[number]) => insurerName(s.merchantKey) ?? s.merchant;
  // Two policies from one insurer are told apart by their price (debugger 11-01: a car and a
  // renters policy both read "Your USAA insurance could cost less").
  const named = new Map<string, number>();
  for (const s of found) named.set(nameOf(s), (named.get(nameOf(s)) ?? 0) + 1);
  // A company whose name already says insurance is "Your Next Insurance policy", not "Your Next
  // Insurance insurance" (debugger 11-02).
  const whatOf = (s: (typeof found)[number]) =>
    /\binsurance$/i.test(nameOf(s)) ? `${nameOf(s)} policy` : `${nameOf(s)} insurance`;
  return found.map((stream) => ({
    type: "insurance_reshop",
    key: stream.key,
    title:
      (named.get(nameOf(stream)) ?? 0) > 1
        ? `Your ${whatOf(stream)} at ${formatCents(stream.lastAmountCents)} could cost less`
        : `Your ${whatOf(stream)} could cost less`,
    annualSavingsCents: null,
    amountCents: stream.annualCostCents ?? stream.lastAmountCents,
    confidence: stream.confidence,
    evidence: streamEvidence(stream),
  }));
};
