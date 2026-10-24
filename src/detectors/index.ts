import { DEBT_DETECTORS } from "./debt";
import { HOLDINGS_DETECTORS } from "./holdings";
import { FIT_DETECTORS } from "./fit";
import { HOME_DETECTORS } from "./home";
import { LIFE_DETECTORS } from "./life";
import { CONTROLLER_DETECTORS } from "./controller";
import { COVER_GAP_DETECTORS } from "./cover-gaps";
import { FIGURES_DETECTORS } from "./figures";
import { INSURANCE_DETECTORS } from "./insurance";
import { PLANNING_DETECTORS } from "./planning";
import { INVESTING_DETECTORS } from "./investing";
import { MONEY_DETECTORS } from "./money";
import { FAMILY_CREDIT_DETECTORS } from "./family-credit";
import { RENTING_DETECTORS } from "./renting";
import { RETIREMENT_DETECTORS } from "./retirement";
import { PRACTICE_DETECTORS } from "./practice";
import { BORROWING_POWER_DETECTORS } from "./borrowing-power";
import { PRACTICE_IDEA_DETECTORS } from "./practice-ideas";
import { SPENDING_DETECTORS } from "./spending";
import { PRICE_RISE_DETECTORS } from "./price-rises";
import { TAX_DETECTORS } from "./taxes";
import { TWO_DETECTORS } from "./two";
import { TRADEOFF_DETECTORS } from "./tradeoffs";
import { WORK_DETECTORS } from "./work";
import type { Detector, DetectorContext, Suggestion } from "./contract";

// Every detector (spec step 254). A capability's detectors are the entries with its id.
// Phase AS (steps 259–266) adds each lane's own; the test in ./detectors.test.ts fails for a
// registry capability with neither a detector nor a reason in src/config/detector-exempt.ts.

export const DETECTORS: readonly Detector[] = [
  ...MONEY_DETECTORS,
  ...HOME_DETECTORS,
  ...WORK_DETECTORS,
  ...LIFE_DETECTORS,
  ...INSURANCE_DETECTORS,
  ...COVER_GAP_DETECTORS,
  ...DEBT_DETECTORS,
  ...FIT_DETECTORS,
  ...SPENDING_DETECTORS,
  ...RENTING_DETECTORS,
  ...BORROWING_POWER_DETECTORS,
  ...FAMILY_CREDIT_DETECTORS,
  ...TAX_DETECTORS,
  ...INVESTING_DETECTORS,
  ...HOLDINGS_DETECTORS,
  ...PRICE_RISE_DETECTORS,
  ...FIGURES_DETECTORS,
  ...CONTROLLER_DETECTORS,
  ...PRACTICE_DETECTORS,
  ...PLANNING_DETECTORS,
  ...TWO_DETECTORS,
  ...TRADEOFF_DETECTORS,
  ...PRACTICE_IDEA_DETECTORS,
  // Detector coverage: the run-up to retirement.
  ...RETIREMENT_DETECTORS,
];

export const detectorsFor = (capability: string) =>
  DETECTORS.filter((d) => d.capability === capability);

// Runs every detector on one person. A detector that throws is skipped rather than hiding
// the rest (the scan must not lose everyone's suggestions to one bug), and reported.
export function runDetectors(
  ctx: DetectorContext,
  detectors: readonly Detector[] = DETECTORS,
  onError: (detector: Detector, error: unknown) => void = () => {},
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const d of detectors) {
    try {
      const s = d.detect(ctx);
      if (s) out.push(s);
    } catch (error) {
      onError(d, error);
    }
  }
  return out;
}

export type { Detector, DetectorContext, Suggestion } from "./contract";
