import type { FilingStatus } from "@/config/tax";
import type { EstimateIncome } from "@/planning/tax-estimate";
import type { FigureId } from "./figures";

// The accuracy bench (Tax T2, roadmap part 1.10): fixed cases with a known right answer and where it
// came from. Money in cents, as everywhere.

export type CaseSource = Readonly<{
  // irs_example: a worked example or a published table row in an IRS document; hand: worked by hand
  // from the cited figures (the arithmetic is in `note`); the others arrive with later steps.
  kind: "irs_example" | "ftb_example" | "ats_scenario" | "hand" | "oracle";
  // https address of the document, on an IRS, FTB or law host (ALLOWED_SOURCE_HOSTS).
  url: string;
  // Publication, tax year, page or section: enough to find the example again.
  where: string;
}>;

// Who the person is, in the fields today's estimator takes. The household record (T9) replaces it.
export type SerializedHousehold = Readonly<{
  filingStatus: FilingStatus;
  childrenUnder17: number;
  otherDependants: number;
  age?: number | null;
  state: string | null;
}>;

// A case that fails today because of a defect the roadmap already knows. It is never deleted and
// never "fixed" by changing the estimator in T2: the bench asserts that exactly `figures` are wrong,
// so the day the step named in `steps` lands, the case fails as "now passes" and the builder of that
// step removes the entry (or narrows `figures`). `steps` names roadmap steps ("T5") or "unowned"
// when no step owns the defect yet.
export type ExpectedFailure = Readonly<{
  steps: readonly string[];
  figures: readonly FigureId[];
  reason: string;
}>;

export type BenchCase = Readonly<{
  id: string;
  title: string;
  taxYear: number;
  source: CaseSource;
  household: SerializedHousehold;
  // Income lines not named are 0; Social Security wages default to the wages.
  income: Partial<EstimateIncome>;
  // Other estimate inputs (withholding, deductions). A key the estimator does not take yet must be
  // in FUTURE_INPUTS with the step that adds it: the estimator ignores it until then.
  extra?: Readonly<Record<string, unknown>>;
  expected: Readonly<Partial<Record<FigureId, number>>>;
  // Cents of slack per figure. Only the IRS Tax Table or an outside calculator's rounding may
  // widen it, with the reason in `note`.
  tolerance?: Readonly<Partial<Record<FigureId, number>>>;
  expectedFailure?: ExpectedFailure;
  note?: string;
}>;
