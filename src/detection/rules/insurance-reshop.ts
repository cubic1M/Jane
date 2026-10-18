import { INSURANCE_CATEGORIES } from "@/config/detection";
import { inList } from "../helpers";
import { streamEvidence, type Rule } from "./rule";

// A recurring insurance payment. No dollar estimate until a partner quote exists; the card
// says "could be lower, get quotes".
export const insuranceReshop: Rule = (_input, streams) =>
  streams
    .filter((s) => s.active && inList(s.pfcDetailed, INSURANCE_CATEGORIES))
    .map((stream) => ({
      type: "insurance_reshop",
      key: stream.key,
      title: `Your ${stream.merchant} insurance could cost less`,
      annualSavingsCents: null,
      amountCents: stream.annualCostCents ?? stream.lastAmountCents,
      confidence: stream.confidence,
      evidence: streamEvidence(stream),
    }));
