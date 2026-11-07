// Utility bill-assistance programmes (connectors roadmap round 17, utility_discount_eligibility_hint).
// FOR REVIEW: each row has its dates and source; a hint says "you may qualify" and links to the
// programme, never that the person does. Income is gross yearly household income.

const $ = (dollars: number) => Math.round(dollars * 100);

// California's CARE and FERA, 2026-06-01 to 2027-05-31 (connectors roadmap round 17). Income limits
// by household size: 1-2 people share the first row; each extra person adds the last. FERA starts $1
// above CARE and needs three or more people at most utilities. The discounts are the CPUC's: CARE
// 30-35% off electric and 20% off gas, FERA 18% off electric.
export const CA_CARE_FERA = {
  state: "CA",
  from: "2026-06-01",
  until: "2027-05-31",
  care: {
    limits: [
      $(43_280),
      $(43_280),
      $(54_640),
      $(66_000),
      $(77_360),
      $(88_720),
      $(100_080),
      $(111_440),
    ],
    eachExtra: $(11_360),
    lowestDiscount: 0.2,
    url: "https://www.cpuc.ca.gov/consumer-support/financial-assistance-savings-and-discounts/care",
  },
  fera: {
    limits: [
      $(54_100),
      $(54_100),
      $(68_300),
      $(82_500),
      $(96_700),
      $(110_900),
      $(125_100),
      $(139_300),
    ],
    eachExtra: $(14_200),
    minPeople: 3,
    lowestDiscount: 0.18,
    url: "https://www.cpuc.ca.gov/consumer-support/financial-assistance-savings-and-discounts/fera",
  },
} as const;

// The income limit for a household of `people` (1 or more).
export function caLimit(
  table: { limits: readonly number[]; eachExtra: number },
  people: number,
): number {
  const n = Math.max(1, Math.floor(people));
  const last = table.limits.length;
  return n <= last ? table.limits[n - 1]! : table.limits[last - 1]! + (n - last) * table.eachExtra;
}
