// Disasters and losses (spec step 270). FOR REVIEW. The disaster relief feed here is a STAND-IN:
// sample declarations shaped like the IRS's "Tax relief in disaster situations" notices (IRS
// news releases IR-YYYY-NN, one per state and disaster, listing the counties, the incident
// date and the date deadlines are postponed to). Before real people rely on it, swap in a feed
// read from the IRS disaster relief page and FEMA's OpenFEMA "DisasterDeclarationsSummaries"
// API (src/lib/disaster-feed). Every sample entry says it is a sample.
//
// Rules (sources): IRC 7508A and Rev. Proc. 2018-58 (what a postponement covers: filing and
// paying income tax, estimated tax payments, IRA and HSA contributions for the prior year, and
// other time-sensitive acts, for deadlines falling in the period); IRS Publication 547 and
// Form 4684 (personal casualty losses: only from a federally declared disaster, reduced by
// insurance and other reimbursement, by $100 per event and by 10% of adjusted gross income; a
// "qualified disaster loss" under a special law uses a $500 floor, no 10% reduction, and can be
// added to the standard deduction). ESTIMATE TO VERIFY each year.

export type Relief = {
  // Stable id, used to apply a postponement once.
  id: string;
  title: string;
  state: string;
  counties: readonly string[];
  // Deadlines falling from this day up to postponedTo move to postponedTo.
  incidentFrom: string;
  postponedTo: string;
  // The state's tax agency postponed its own deadlines to the same date.
  stateFollows: boolean;
  // A federally declared disaster: personal casualty losses can be deducted.
  federallyDeclared: boolean;
  // A qualified disaster loss under a special disaster tax relief law.
  qualified: boolean;
  source: string;
  // A stand-in entry, not a real declaration.
  sample: boolean;
};

export const SAMPLE_RELIEF: readonly Relief[] = [
  {
    id: "SAMPLE-TX-2026-09",
    title: "Severe storms and flooding (sample declaration)",
    state: "TX",
    counties: ["Harris", "Fort Bend", "Galveston", "Brazoria"],
    incidentFrom: "2026-09-08",
    postponedTo: "2027-05-03",
    stateFollows: false,
    federallyDeclared: true,
    qualified: false,
    source: "Stand-in feed: a sample shaped like an IRS disaster relief news release",
    sample: true,
  },
  {
    id: "SAMPLE-CA-2026-08",
    title: "Wildfires (sample declaration)",
    state: "CA",
    counties: ["Sonoma", "Napa", "Lake"],
    incidentFrom: "2026-08-14",
    postponedTo: "2027-04-30",
    stateFollows: true,
    federallyDeclared: true,
    qualified: false,
    source: "Stand-in feed: a sample shaped like an IRS disaster relief news release",
    sample: true,
  },
];

// Personal casualty losses (Publication 547).
export const CASUALTY = {
  perEventFloorCents: 10_000,
  qualifiedFloorCents: 50_000,
  agiShare: 0.1,
} as const;

// Spending after the disaster that looks like repairing the damage.
export const REPAIR_CATEGORIES: readonly string[] = ["HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE"];
export const REPAIR_PAYEE =
  /ROOF|RESTORATION|WATER DAMAGE|WATER EXTRACTION|MOLD|TREE (?:REMOVAL|SERVICE)|FLOOD|STORM|SERVPRO|DEBRIS/i;
// Money back for it: an insurance claim payment, or FEMA assistance.
export const REIMBURSEMENT_PAYEE =
  /\bCLAIM\b|\bFEMA\b|DISASTER ASSIST|INSURANCE (?:PAYMENT|PROCEEDS)/i;

// Deadlines on the person's list that are federal tax deadlines a postponement covers.
export const TAX_DEADLINE_TITLE =
  /\b(?:tax(?:es)?|IRS|estimated (?:tax|payment)|IRA contribution|HSA contribution|Form \d{3,4}|IP PIN|1040|extension)\b/i;

// A county named in a payee ("HARRIS COUNTY TAX ASSESSOR").
export const COUNTY_IN_PAYEE = /\b([A-Z][A-Z.'-]*(?: [A-Z][A-Z.'-]*)?) COUNTY\b/;
