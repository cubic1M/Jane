import { evidenceOf } from "../helpers";
import type { Stream } from "../streams";
import type { Candidate, DetectionInput, Evidence } from "../types";

// Every rule has this shape: the user's data in, candidate findings out. Rules never touch
// the database and read every number from src/config/detection.ts.
export type Rule = (input: DetectionInput, streams: Stream[]) => Candidate[];

export function streamEvidence(stream: Stream): Evidence {
  return {
    merchant: stream.merchant,
    frequency: stream.frequency,
    lastAmountCents: stream.lastAmountCents,
    annualCostCents: stream.annualCostCents,
    charges: stream.charges.map(evidenceOf),
  };
}
