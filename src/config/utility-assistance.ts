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

// The federal poverty line's 2026 figures as USAC states them at 135% (Lifeline's limit, 48 states and
// DC): $21,546 for one person, plus $7,668 for each added person. Alaska and Hawaii are higher and
// left out. The 100% line is the same figures divided by 1.35.
const POVERTY_135 = { first: $(21_546), eachAdded: $(7_668) } as const;
export function povertyLine(people: number, share: number): number {
  const n = Math.max(1, Math.floor(people));
  return Math.round(((POVERTY_135.first + (n - 1) * POVERTY_135.eachAdded) / 1.35) * share);
}

// Lifeline (USAC): up to $9.25 a month off phone or internet, one per household, for income at or
// under 135% of the poverty line or SNAP, Medicaid, SSI, Federal Public Housing or a VA pension.
// The person applies themselves through the National Verifier. A 2026 FCC proposal could narrow it
// to citizens and qualified noncitizens (pending).
export const LIFELINE = {
  incomeShare: 1.35,
  monthlyCents: 925,
  excludedStates: ["AK", "HI"],
  url: "https://www.usac.org/lifeline/consumer-eligibility/",
  apply: "https://nv.fcc.gov",
} as const;

// Internet providers' low-income plans (connectors roadmap round 17, as of 2026-11-06), each open at
// or under 200% of the poverty line or through programmes like SNAP. Matched by the internet bill's
// payee. Prices are the providers' own; check before signing up. A plan has its monthly price or the
// most it takes off; AT&T Access prices by address, so it's left out until a price can be said.
export const LOW_COST_INTERNET = {
  incomeShare: 2,
  plans: [
    {
      isp: "Xfinity",
      match: /\b(?:comcast|xfinity)\b/i,
      plan: "Internet Essentials, $14.95 a month for 75 Mbps",
      priceCents: 1_495,
      url: "https://www.xfinity.com/learn/internet-service/internet-essentials",
    },
    {
      isp: "Spectrum",
      match: /\b(?:spectrum|charter)\b/i,
      plan: "Spectrum Internet Assist, $15 a month for 50 Mbps",
      priceCents: 1_500,
      url: "https://www.spectrum.com/internet/spectrum-internet-assist",
    },
    {
      isp: "Verizon",
      match: /\bverizon\b|\bfios\b/i,
      plan: "Verizon Forward, up to $30 a month off home internet",
      offCents: 3_000,
      url: "https://www.verizon.com/discounts/verizon-forward/",
    },
  ],
} as const;
