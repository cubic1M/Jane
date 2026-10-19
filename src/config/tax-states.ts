import type { Bracket } from "@/config/tax-rates";

// State and local income taxes (spec step 165). FOR REVIEW, like src/config/tax-rates.ts.
// The rates themselves are in tax-rates.ts STATE_TAX; here, where each state's figures come
// from, which states still need their own schedules added, the local income taxes Jane
// knows, and the rules for living or working in more than one state.

const $ = (dollars: number) => Math.round(dollars * 100);

// Each state's tax agency: the source for its figures. `toAdd`: Jane uses a rough rate for
// this state until its own brackets are added from that source.
export const STATE_SOURCES: Readonly<
  Record<string, { agency: string; url: string; toAdd?: true }>
> = {
  AK: { agency: "Alaska Department of Revenue", url: "https://revenue.alaska.gov" },
  AL: {
    agency: "Alabama Department of Revenue",
    url: "https://www.revenue.alabama.gov",
    toAdd: true,
  },
  AR: {
    agency: "Arkansas Department of Finance and Administration",
    url: "https://www.dfa.arkansas.gov",
    toAdd: true,
  },
  AZ: { agency: "Arizona Department of Revenue", url: "https://azdor.gov" },
  CA: { agency: "California Franchise Tax Board", url: "https://www.ftb.ca.gov" },
  CO: { agency: "Colorado Department of Revenue", url: "https://tax.colorado.gov" },
  CT: {
    agency: "Connecticut Department of Revenue Services",
    url: "https://portal.ct.gov/drs",
    toAdd: true,
  },
  DC: { agency: "DC Office of Tax and Revenue", url: "https://otr.cfo.dc.gov", toAdd: true },
  DE: { agency: "Delaware Division of Revenue", url: "https://revenue.delaware.gov", toAdd: true },
  FL: { agency: "Florida Department of Revenue", url: "https://floridarevenue.com" },
  GA: { agency: "Georgia Department of Revenue", url: "https://dor.georgia.gov" },
  HI: { agency: "Hawaii Department of Taxation", url: "https://tax.hawaii.gov", toAdd: true },
  IA: { agency: "Iowa Department of Revenue", url: "https://tax.iowa.gov" },
  ID: { agency: "Idaho State Tax Commission", url: "https://tax.idaho.gov" },
  IL: { agency: "Illinois Department of Revenue", url: "https://tax.illinois.gov" },
  IN: { agency: "Indiana Department of Revenue", url: "https://www.in.gov/dor" },
  KS: { agency: "Kansas Department of Revenue", url: "https://www.ksrevenue.gov", toAdd: true },
  KY: { agency: "Kentucky Department of Revenue", url: "https://revenue.ky.gov" },
  LA: { agency: "Louisiana Department of Revenue", url: "https://revenue.louisiana.gov" },
  MA: { agency: "Massachusetts Department of Revenue", url: "https://www.mass.gov/dor" },
  MD: { agency: "Comptroller of Maryland", url: "https://www.marylandtaxes.gov", toAdd: true },
  ME: { agency: "Maine Revenue Services", url: "https://www.maine.gov/revenue", toAdd: true },
  MI: { agency: "Michigan Department of Treasury", url: "https://www.michigan.gov/taxes" },
  MN: {
    agency: "Minnesota Department of Revenue",
    url: "https://www.revenue.state.mn.us",
    toAdd: true,
  },
  MO: { agency: "Missouri Department of Revenue", url: "https://dor.mo.gov", toAdd: true },
  MS: { agency: "Mississippi Department of Revenue", url: "https://www.dor.ms.gov" },
  MT: { agency: "Montana Department of Revenue", url: "https://mtrevenue.gov", toAdd: true },
  NC: { agency: "North Carolina Department of Revenue", url: "https://www.ncdor.gov" },
  ND: {
    agency: "North Dakota Office of State Tax Commissioner",
    url: "https://www.tax.nd.gov",
    toAdd: true,
  },
  NE: {
    agency: "Nebraska Department of Revenue",
    url: "https://revenue.nebraska.gov",
    toAdd: true,
  },
  NH: {
    agency: "New Hampshire Department of Revenue Administration",
    url: "https://www.revenue.nh.gov",
  },
  NJ: {
    agency: "New Jersey Division of Taxation",
    url: "https://www.nj.gov/treasury/taxation",
    toAdd: true,
  },
  NM: {
    agency: "New Mexico Taxation and Revenue Department",
    url: "https://www.tax.newmexico.gov",
    toAdd: true,
  },
  NV: { agency: "Nevada Department of Taxation", url: "https://tax.nv.gov" },
  NY: {
    agency: "New York State Department of Taxation and Finance",
    url: "https://www.tax.ny.gov",
  },
  OH: { agency: "Ohio Department of Taxation", url: "https://tax.ohio.gov", toAdd: true },
  OK: { agency: "Oklahoma Tax Commission", url: "https://oklahoma.gov/tax", toAdd: true },
  OR: { agency: "Oregon Department of Revenue", url: "https://www.oregon.gov/dor", toAdd: true },
  PA: { agency: "Pennsylvania Department of Revenue", url: "https://www.revenue.pa.gov" },
  RI: { agency: "Rhode Island Division of Taxation", url: "https://tax.ri.gov", toAdd: true },
  SC: { agency: "South Carolina Department of Revenue", url: "https://dor.sc.gov", toAdd: true },
  SD: { agency: "South Dakota Department of Revenue", url: "https://dor.sd.gov" },
  TN: { agency: "Tennessee Department of Revenue", url: "https://www.tn.gov/revenue" },
  TX: { agency: "Texas Comptroller of Public Accounts", url: "https://comptroller.texas.gov" },
  UT: { agency: "Utah State Tax Commission", url: "https://tax.utah.gov" },
  VA: {
    agency: "Virginia Department of Taxation",
    url: "https://www.tax.virginia.gov",
    toAdd: true,
  },
  VT: { agency: "Vermont Department of Taxes", url: "https://tax.vermont.gov", toAdd: true },
  WA: { agency: "Washington Department of Revenue", url: "https://dor.wa.gov" },
  WI: { agency: "Wisconsin Department of Revenue", url: "https://www.revenue.wi.gov", toAdd: true },
  WV: { agency: "West Virginia Tax Division", url: "https://tax.wv.gov", toAdd: true },
  WY: { agency: "Wyoming Department of Revenue", url: "https://revenue.wyo.gov" },
};

// Local income taxes on residents. ESTIMATE TO VERIFY: 2025 rates from each city's or
// county's own tax office; Jane applies them to the base named:
// - taxable: the state's taxable income (New York City's own brackets);
// - wages: wages and freelance income (city wage and earnings taxes);
// - state_tax: a share of the state tax (Yonkers' resident surcharge).
export type LocalTax = {
  state: string;
  label: string;
  base: "taxable" | "wages" | "state_tax";
  rate?: number;
  brackets?: readonly Bracket[];
  source: string;
  url: string;
};

export const LOCAL_TAXES: Readonly<Record<string, LocalTax>> = {
  nyc: {
    state: "NY",
    label: "New York City",
    base: "taxable",
    brackets: [
      { over: 0, rate: 0.03078 },
      { over: $(12_000), rate: 0.03762 },
      { over: $(25_000), rate: 0.03819 },
      { over: $(50_000), rate: 0.03876 },
    ],
    source: "NYC Department of Finance, resident rates (single filer brackets)",
    url: "https://www.nyc.gov/site/finance",
  },
  yonkers: {
    state: "NY",
    label: "Yonkers",
    base: "state_tax",
    rate: 0.1675,
    source: "Yonkers resident surcharge, 16.75% of the New York State tax",
    url: "https://www.tax.ny.gov",
  },
  philadelphia: {
    state: "PA",
    label: "Philadelphia",
    base: "wages",
    rate: 0.0374,
    source: "Philadelphia Department of Revenue, resident wage tax",
    url: "https://www.phila.gov/departments/department-of-revenue",
  },
  pittsburgh: {
    state: "PA",
    label: "Pittsburgh",
    base: "wages",
    rate: 0.03,
    source: "City of Pittsburgh (1%) and school district (2%) earned income tax",
    url: "https://pittsburghpa.gov/finance",
  },
  detroit: {
    state: "MI",
    label: "Detroit",
    base: "wages",
    rate: 0.024,
    source: "City of Detroit Income Tax Division, resident rate",
    url: "https://detroitmi.gov/departments/office-chief-financial-officer/ocfo-divisions/office-treasury/income-tax",
  },
  columbus: {
    state: "OH",
    label: "Columbus",
    base: "wages",
    rate: 0.025,
    source: "City of Columbus Income Tax Division",
    url: "https://www.columbus.gov/incometax",
  },
  cleveland: {
    state: "OH",
    label: "Cleveland",
    base: "wages",
    rate: 0.025,
    source: "Central Collection Agency (Cleveland)",
    url: "https://ccatax.ci.cleveland.oh.us",
  },
  kansas_city: {
    state: "MO",
    label: "Kansas City",
    base: "wages",
    rate: 0.01,
    source: "Kansas City, Missouri earnings tax",
    url: "https://www.kcmo.gov/city-hall/departments/finance/revenue-division",
  },
  st_louis: {
    state: "MO",
    label: "St. Louis",
    base: "wages",
    rate: 0.01,
    source: "City of St. Louis earnings tax",
    url: "https://www.stlouis-mo.gov/government/departments/collector-revenue",
  },
  baltimore: {
    state: "MD",
    label: "Baltimore City",
    base: "taxable",
    rate: 0.032,
    source: "Comptroller of Maryland, local income tax rates",
    url: "https://www.marylandtaxes.gov",
  },
};

// States that tax a nonresident's wages for remote work done from home for an employer in
// the state (the "convenience of the employer" rule). FOR REVIEW.
export const CONVENIENCE_RULE_STATES: readonly string[] = ["NY", "PA", "DE", "NE", "CT"];
