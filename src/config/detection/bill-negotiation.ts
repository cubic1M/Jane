import type { PfcDetailed } from "@/categorize/taxonomy";

// --- Bill negotiation ---------------------------------------------------------------

// Typical monthly prices for bills people can often negotiate down. A recurring bill
// above the top of its range becomes a finding; the estimate is the gap to the top, for
// a year. These are estimates, not quotes. Insurance isn't here: insurance_reshop covers
// it, and fair prices depend too much on the person (car, home, state) for one range.
export const BILL_BENCHMARKS: readonly {
  id: string;
  label: string;
  categories: readonly PfcDetailed[];
  merchants: readonly string[];
  typicalLowCents: number;
  typicalHighCents: number;
  // Where the range comes from. Review against current list prices before the beta.
  source: string;
}[] = [
  {
    id: "phone",
    label: "phone",
    categories: ["RENT_AND_UTILITIES_TELEPHONE"],
    merchants: ["verizon wireless", "t mobile", "at t mobility", "mint mobile", "visible"],
    typicalLowCents: 3_000,
    typicalHighCents: 10_000,
    source:
      "Our estimate (Oct 2026) from major US carriers' published single-line and two-line plan prices, before taxes and device payments.",
  },
  {
    id: "internet_tv",
    label: "internet and TV",
    categories: ["RENT_AND_UTILITIES_INTERNET_AND_CABLE"],
    merchants: ["comcast", "xfinity", "spectrum", "cox communications", "optimum", "directv"],
    typicalLowCents: 5_000,
    typicalHighCents: 12_000,
    source:
      "Our estimate (Oct 2026) from major US providers' published home internet prices, with room for a basic TV package.",
  },
];
// A bill only counts when it's this much (in cents a month) above the typical range, so
// a few cents of tax over the line isn't a finding.
export const BILL_NEGOTIATION_MIN_GAP_CENTS = 1_000;
