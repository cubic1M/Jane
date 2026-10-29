import {
  BILL_BENCHMARKS,
  BILL_NEGOTIATION_MIN_GAP_CENTS,
  CHARGES_PER_YEAR,
} from "@/config/detection";
import { inList, lowest, merchantMatches } from "../helpers";
import type { Stream } from "../streams";
import type { Candidate } from "../types";
import { streamEvidence, type Rule } from "./rule";

const MONTHS_PER_YEAR = CHARGES_PER_YEAR.MONTHLY;

// The kind of bill a stream is (phone, internet), with its typical price; undefined for others.
export const benchmarkOf = (stream: Stream) =>
  BILL_BENCHMARKS.find(
    (b) =>
      inList(stream.pfcDetailed, b.categories) || merchantMatches(stream.merchantKey, b.merchants),
  );

// A phone or internet bill priced above the typical range for that kind of bill. The
// estimate is what bringing it down to the top of the range would save in a year: an
// estimate, never a promise of what the provider will agree to.
export const billNegotiation: Rule = (_input, streams) =>
  streams.flatMap((stream): Candidate[] => {
    if (!stream.active || stream.annualCostCents === null) return [];
    const benchmark = benchmarkOf(stream);
    if (!benchmark) return [];

    const monthly = Math.round(stream.annualCostCents / MONTHS_PER_YEAR);
    const gap = monthly - benchmark.typicalHighCents;
    if (gap < BILL_NEGOTIATION_MIN_GAP_CENTS) return [];

    return [
      {
        type: "bill_negotiation",
        key: stream.key,
        title: `Your ${stream.merchant} ${benchmark.label} bill is above the typical price`,
        annualSavingsCents: gap * MONTHS_PER_YEAR,
        amountCents: monthly,
        confidence: lowest(stream.confidence, "medium"),
        evidence: {
          ...streamEvidence(stream),
          billKind: benchmark.label,
          monthlyCents: monthly,
          typicalLowCents: benchmark.typicalLowCents,
          typicalHighCents: benchmark.typicalHighCents,
          benchmarkSource: benchmark.source,
        },
      },
    ];
  });
