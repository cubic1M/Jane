// Property tax that's too high (spec step 221). FOR REVIEW. Every state's rules change, and
// counties differ within a state: the appeal windows and exemptions below are what the
// state's own guidance says in outline, ESTIMATE TO VERIFY against the county assessor's
// notice, which is what the person's deadline really is. States not listed fall back to the
// default and tell the person to read the date on their notice.
//
// Sources: each state's department of revenue / county assessor guidance, named per entry.

// An appeal is only suggested when the assessment is over the market value by at least this
// much of the market value, and the tax it would save is at least the second figure a year.
export const APPEAL_GAP_RATE = 0.07;
export const APPEAL_MIN_SAVING_CENTS = 15_000;

// The demo bank's stand-in county record and sales data (src/lib/property/demo.ts): the
// home is worth its mortgage balance over this share, and the county assessed it this much
// above that. Sample data only.
export const DEMO_HOME = { loanToValue: 0.6, overAssessedBy: 1.14, squareFeet: 1_850 } as const;

// How many comparable sales go in a drafted appeal.
export const COMPARABLES_WANTED = 3;

export type AppealWindow = {
  // The board that hears it.
  board: string;
  // A fixed window each year ("MM-DD"), or days after the assessment notice is mailed.
  opens: string | null;
  closes: string | null;
  daysAfterNotice: number | null;
  source: string;
};

// A typical effective property tax rate (tax / market value), used only to price an appeal
// when the person's own tax bill isn't there to measure it. Tax Foundation / Census ACS
// outlines, ESTIMATE TO VERIFY.
export type StateProperty = { name: string; effectiveRate: number; window: AppealWindow };

export const DEFAULT_PROPERTY: StateProperty = {
  name: "your county",
  effectiveRate: 0.011,
  window: {
    board: "your county's board of review",
    opens: null,
    closes: null,
    daysAfterNotice: 45,
    source: "Varies by county; the deadline is printed on the assessment notice.",
  },
};

export const STATE_PROPERTY: Readonly<Record<string, StateProperty>> = {
  CA: {
    name: "California",
    effectiveRate: 0.0071,
    window: {
      board: "the county Assessment Appeals Board",
      opens: "07-02",
      closes: "11-30",
      daysAfterNotice: null,
      source:
        "California State Board of Equalization, Property Taxes: assessment appeals (a Prop 8 decline-in-value review: file July 2 to November 30 in most counties).",
    },
  },
  TX: {
    name: "Texas",
    effectiveRate: 0.016,
    window: {
      board: "the county Appraisal Review Board",
      opens: null,
      closes: "05-15",
      daysAfterNotice: 30,
      source:
        "Texas Comptroller, Property Tax Assistance: protest by May 15 or 30 days after the notice, whichever is later.",
    },
  },
  FL: {
    name: "Florida",
    effectiveRate: 0.0083,
    window: {
      board: "the Value Adjustment Board",
      opens: null,
      closes: null,
      daysAfterNotice: 25,
      source:
        "Florida Department of Revenue: petition the Value Adjustment Board within 25 days of the Notice of Proposed Property Taxes.",
    },
  },
  NY: {
    name: "New York",
    effectiveRate: 0.014,
    window: {
      board: "the local Board of Assessment Review",
      opens: null,
      closes: null,
      daysAfterNotice: 21,
      source:
        "New York State Department of Taxation and Finance: file a complaint on Grievance Day, set by your town and usually in May.",
    },
  },
  NJ: {
    name: "New Jersey",
    effectiveRate: 0.0223,
    window: {
      board: "the County Board of Taxation",
      opens: null,
      closes: "04-01",
      daysAfterNotice: null,
      source: "New Jersey Division of Taxation: appeal to the County Board of Taxation by April 1.",
    },
  },
  IL: {
    name: "Illinois",
    effectiveRate: 0.0208,
    window: {
      board: "the county Board of Review",
      opens: null,
      closes: null,
      daysAfterNotice: 30,
      source:
        "Illinois Department of Revenue: file with the county Board of Review within 30 days of the publication of your township's assessments.",
    },
  },
  PA: {
    name: "Pennsylvania",
    effectiveRate: 0.0153,
    window: {
      board: "the county Board of Assessment Appeals",
      opens: null,
      closes: "09-01",
      daysAfterNotice: null,
      source:
        "Pennsylvania county assessment offices: appeals are due by September 1 in most counties.",
    },
  },
  MA: {
    name: "Massachusetts",
    effectiveRate: 0.0113,
    window: {
      board: "the town Board of Assessors",
      opens: null,
      closes: null,
      daysAfterNotice: 30,
      source:
        "Massachusetts Department of Revenue: apply for an abatement by the due date of the first actual tax bill, usually 30 days.",
    },
  },
  OH: {
    name: "Ohio",
    effectiveRate: 0.0153,
    window: {
      board: "the county Board of Revision",
      opens: null,
      closes: "03-31",
      daysAfterNotice: null,
      source:
        "Ohio Department of Taxation: file a complaint with the county Board of Revision by March 31.",
    },
  },
  WA: {
    name: "Washington",
    effectiveRate: 0.0087,
    window: {
      board: "the county Board of Equalization",
      opens: null,
      closes: null,
      daysAfterNotice: 60,
      source:
        "Washington Department of Revenue: petition within 60 days of the assessment notice or July 1, whichever is later.",
    },
  },
};

export type ExemptionKind = "homestead" | "senior" | "veteran" | "disabled";

export type Exemption = {
  key: string;
  kind: ExemptionKind;
  name: string;
  // Who it is for, in a sentence.
  who: string;
  // What it takes off, in words (amounts change; the county has the current figure).
  benefit: string;
  // Known facts that make someone eligible. A missing fact is asked, not assumed.
  needs: { minAge?: number; veteran?: true; disabled?: true };
  source: string;
};

export const EXEMPTIONS: Readonly<Record<string, readonly Exemption[]>> = {
  CA: [
    {
      key: "ca_homeowners",
      kind: "homestead",
      name: "Homeowners' Exemption",
      who: "Owners who live in the home as their main home on January 1.",
      benefit: "Takes $7,000 off the assessed value, about $70 a year in tax.",
      needs: {},
      source:
        "California State Board of Equalization, Homeowners' Exemption (claim once, with the county assessor).",
    },
    {
      key: "ca_veteran",
      kind: "veteran",
      name: "Veterans' Exemption",
      who: "Veterans of wartime service, with limits on the value of the property.",
      benefit: "Takes a fixed amount off the assessed value (the county has the current amount).",
      needs: { veteran: true },
      source: "California State Board of Equalization, Veterans' Exemption.",
    },
    {
      key: "ca_disabled_veteran",
      kind: "disabled",
      name: "Disabled Veterans' Exemption",
      who: "Veterans with a service-connected disability rated at least 80% (or who are blind or have lost the use of limbs).",
      benefit: "A much larger amount off the assessed value, based on income.",
      needs: { veteran: true, disabled: true },
      source: "California State Board of Equalization, Disabled Veterans' Exemption.",
    },
  ],
  TX: [
    {
      key: "tx_homestead",
      kind: "homestead",
      name: "Residence homestead exemption",
      who: "Owners who live in the home as their main home on January 1.",
      benefit:
        "Takes a large amount off the value schools tax, and caps how fast the taxable value can rise.",
      needs: {},
      source: "Texas Comptroller, Property Tax Exemptions: residence homestead.",
    },
    {
      key: "tx_over65",
      kind: "senior",
      name: "Over-65 exemption",
      who: "Owners aged 65 or older.",
      benefit: "An extra amount off the school tax value and a freeze on the school tax.",
      needs: { minAge: 65 },
      source: "Texas Comptroller, Property Tax Exemptions: over-65 and disabled.",
    },
    {
      key: "tx_disabled_veteran",
      kind: "disabled",
      name: "Disabled veteran exemption",
      who: "Veterans with a service-connected disability rating of at least 10%.",
      benefit:
        "Takes an amount off the value that depends on the rating; 100% rated veterans owe none on the home.",
      needs: { veteran: true, disabled: true },
      source: "Texas Comptroller, Property Tax Exemptions: disabled veterans.",
    },
  ],
  FL: [
    {
      key: "fl_homestead",
      kind: "homestead",
      name: "Homestead exemption",
      who: "Owners who made the home their permanent residence on January 1. File by March 1.",
      benefit:
        "Takes up to $50,000 off the assessed value, and limits how fast it can rise (the Save Our Homes cap).",
      needs: {},
      source: "Florida Department of Revenue, Property Tax Oversight: homestead exemption.",
    },
    {
      key: "fl_senior",
      kind: "senior",
      name: "Additional senior exemption",
      who: "Owners aged 65 or older with income under the state's limit.",
      benefit: "An extra amount off the assessed value, where the county has adopted it.",
      needs: { minAge: 65 },
      source: "Florida Department of Revenue, Property Tax Oversight: senior exemption.",
    },
    {
      key: "fl_disabled_veteran",
      kind: "disabled",
      name: "Disabled veteran exemption",
      who: "Veterans with a service-connected disability of 10% or more.",
      benefit:
        "Takes a fixed amount off the assessed value; total and permanent disability can exempt it all.",
      needs: { veteran: true, disabled: true },
      source: "Florida Department of Revenue, Property Tax Oversight: veterans.",
    },
  ],
  NY: [
    {
      key: "ny_star",
      kind: "homestead",
      name: "STAR credit or exemption",
      who: "Owners who live in the home as their main home, with income under the state's limit.",
      benefit: "A credit or exemption on the school tax bill.",
      needs: {},
      source: "New York State Department of Taxation and Finance, STAR.",
    },
    {
      key: "ny_senior",
      kind: "senior",
      name: "Enhanced STAR / senior citizens exemption",
      who: "Owners aged 65 or older with income under the limit.",
      benefit: "A larger exemption than basic STAR, on school and some local tax.",
      needs: { minAge: 65 },
      source:
        "New York State Department of Taxation and Finance, Enhanced STAR; Real Property Tax Law §467.",
    },
    {
      key: "ny_veteran",
      kind: "veteran",
      name: "Veterans' exemption",
      who: "Veterans, and some surviving spouses.",
      benefit: "A percentage of the assessed value, larger for wartime and combat service.",
      needs: { veteran: true },
      source:
        "New York State Department of Taxation and Finance, veterans' exemptions (Real Property Tax Law §458).",
    },
  ],
  NJ: [
    {
      key: "nj_senior_freeze",
      kind: "senior",
      name: "Senior Freeze (Property Tax Reimbursement)",
      who: "Owners aged 65 or older, or disabled, with income under the limit, who have lived in the home for years.",
      benefit: "Pays back the increase in property tax over the base year.",
      needs: { minAge: 65 },
      source: "New Jersey Division of Taxation, Senior Freeze.",
    },
    {
      key: "nj_veteran",
      kind: "veteran",
      name: "Veteran deduction",
      who: "Veterans with wartime service, and some surviving spouses.",
      benefit: "A $250 deduction on the property tax bill each year.",
      needs: { veteran: true },
      source: "New Jersey Division of Taxation, Veterans' deduction.",
    },
  ],
  IL: [
    {
      key: "il_homestead",
      kind: "homestead",
      name: "General homestead exemption",
      who: "Owners who live in the home as their main home.",
      benefit:
        "Takes up to $10,000 (Cook County) or $6,000 (elsewhere) off the equalized assessed value.",
      needs: {},
      source: "Illinois Department of Revenue, Property Tax Exemptions: homestead.",
    },
    {
      key: "il_senior",
      kind: "senior",
      name: "Senior homestead exemption",
      who: "Owners aged 65 or older.",
      benefit: "Takes an extra $5,000 or more off the equalized assessed value.",
      needs: { minAge: 65 },
      source: "Illinois Department of Revenue, Property Tax Exemptions: senior citizens.",
    },
    {
      key: "il_disabled_veteran",
      kind: "disabled",
      name: "Disabled veterans' exemption",
      who: "Veterans with a service-connected disability.",
      benefit: "Takes $2,500 to $5,000 off, or all of it at 100% disability.",
      needs: { veteran: true, disabled: true },
      source: "Illinois Department of Revenue, Property Tax Exemptions: disabled veterans.",
    },
  ],
  PA: [
    {
      key: "pa_homestead",
      kind: "homestead",
      name: "Homestead / farmstead exclusion",
      who: "Owners who live in the home as their main home, in a school district that has adopted it.",
      benefit: "Takes part of the assessed value off the school tax.",
      needs: {},
      source:
        "Pennsylvania Department of Community and Economic Development, Homestead and Farmstead Exclusion.",
    },
    {
      key: "pa_rebate",
      kind: "senior",
      name: "Property Tax/Rent Rebate",
      who: "Owners aged 65 or older, widows and widowers aged 50 or older, and disabled people aged 18 or older, with income under the limit.",
      benefit: "A rebate of up to several hundred dollars, paid by the state.",
      needs: { minAge: 65 },
      source: "Pennsylvania Department of Revenue, Property Tax/Rent Rebate Program.",
    },
  ],
  MA: [
    {
      key: "ma_senior",
      kind: "senior",
      name: "Clause 41C senior exemption",
      who: "Owners aged 65 or older who have owned the home for years, with income and assets under the limits.",
      benefit: "A fixed amount off the tax bill ($500 by law, more in towns that raised it).",
      needs: { minAge: 65 },
      source: "Massachusetts Department of Revenue, Division of Local Services: Clause 41C.",
    },
    {
      key: "ma_veteran",
      kind: "veteran",
      name: "Clause 22 veterans' exemption",
      who: "Veterans with wartime service or a service-connected disability.",
      benefit: "A fixed amount off the tax bill, larger for higher disability ratings.",
      needs: { veteran: true },
      source: "Massachusetts Department of Revenue, Division of Local Services: Clause 22.",
    },
  ],
  OH: [
    {
      key: "oh_homestead",
      kind: "senior",
      name: "Homestead exemption",
      who: "Owners aged 65 or older, or permanently disabled, under the state's income limit.",
      benefit: "Takes part of the home's market value off before tax.",
      needs: { minAge: 65 },
      source: "Ohio Department of Taxation, Homestead Exemption.",
    },
    {
      key: "oh_disabled_veteran",
      kind: "disabled",
      name: "Disabled veterans' homestead exemption",
      who: "Veterans with a 100% service-connected disability.",
      benefit: "Takes a larger amount off the home's market value.",
      needs: { veteran: true, disabled: true },
      source: "Ohio Department of Taxation, Disabled Veterans' Homestead Exemption.",
    },
  ],
  WA: [
    {
      key: "wa_senior_disabled",
      kind: "senior",
      name: "Senior and disabled persons exemption",
      who: "Owners aged 61 or older, or disabled, under the county's income limit.",
      benefit: "Freezes the home's value for tax and takes part of the levy off.",
      needs: { minAge: 61 },
      source:
        "Washington Department of Revenue, Property tax exemptions for seniors and people with disabilities.",
    },
  ],
};
