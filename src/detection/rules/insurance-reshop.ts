import { INSURANCE_CATEGORIES } from "@/config/detection";
import { insurerName } from "@/insights/found-policies";
import { inList } from "../helpers";
import { coveringCard } from "./covered-by-card";
import { streamEvidence, type Rule } from "./rule";

// A recurring insurance payment. No dollar estimate until a partner quote exists; the card
// says "could be lower, get quotes". A plan a card already covers is raised as that
// instead (spec step 152), not reshopped. A known insurer goes by its name, not the bank's
// line ("STATE FARM RO 27 DES:CPC-CLIENT" is State Farm, not "State Farm Ro 27").
export const insuranceReshop: Rule = (input, streams) =>
  streams
    .filter(
      (s) =>
        s.active && inList(s.pfcDetailed, INSURANCE_CATEGORIES) && !coveringCard(s, input, streams),
    )
    .map((stream) => ({
      type: "insurance_reshop",
      key: stream.key,
      title: `Your ${insurerName(stream.merchantKey) ?? stream.merchant} insurance could cost less`,
      annualSavingsCents: null,
      amountCents: stream.annualCostCents ?? stream.lastAmountCents,
      confidence: stream.confidence,
      evidence: streamEvidence(stream),
    }));
