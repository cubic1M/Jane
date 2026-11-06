// Where to pay a state's estimated income tax, and on what schedule (connectors roadmap round 16,
// `state_estimated_payment_links`): the person pays on the state's own page; Jane gives the link,
// says whether it needs an account, and what's due when. FOR REVIEW, like tax-rates.ts: the
// research could open few of these pages (California's gave 403), so a schedule nobody has checked
// on the state's page says so, and links go to the agency's own site unless a page was named.

export type StateEstimatedTax = {
  // Its payment page's name, and where it is (on the state's own site).
  portal: string;
  url: string;
  // Pay without an account: true, false, or null when nobody has confirmed it.
  guest: boolean | null;
  // What the guest payment asks for.
  asks: readonly string[];
  // Percent of the year's estimate due on each of the federal dates (Apr 15, Jun 15, Sep 15,
  // Jan 15), and whether that split was read on the state's own page.
  shares: readonly [number, number, number, number];
  sharesChecked: boolean;
  // A card payment's fee, in basis points, when the state says.
  cardFeeBps?: number;
  note?: string;
};

const FEDERAL_SPLIT = [25, 25, 25, 25] as const;

// No state income tax: nothing to pay.
export const NO_STATE_INCOME_TAX: readonly string[] = ["TX", "FL"];

export const STATE_ESTIMATED_TAX: Readonly<Record<string, StateEstimatedTax>> = {
  CA: {
    portal: "FTB Web Pay",
    url: "https://www.ftb.ca.gov",
    guest: true,
    asks: [],
    // No September payment.
    shares: [30, 40, 0, 30],
    sharesChecked: true,
    note: "Over $20,000, an estimated payment must be made electronically.",
  },
  NY: {
    portal: "Online Services",
    url: "https://www.tax.ny.gov/pay/ind/pay-estimated-tax.htm",
    // Quick Pay covers bills, notices and installment agreements, not estimated tax.
    guest: false,
    asks: [],
    shares: FEDERAL_SPLIT,
    sharesChecked: false,
    cardFeeBps: 220,
  },
  IL: {
    portal: "MyTax Illinois",
    url: "https://tax.illinois.gov",
    guest: true,
    asks: [],
    shares: FEDERAL_SPLIT,
    sharesChecked: false,
    note: "Pick the IL-1040-ES payment type, or it isn't counted as an estimated payment. This year's only.",
  },
  PA: {
    portal: "myPATH",
    url: "https://www.revenue.pa.gov",
    guest: true,
    asks: [],
    shares: FEDERAL_SPLIT,
    sharesChecked: false,
    cardFeeBps: 285,
  },
  NJ: {
    portal: "NJ e-check",
    url: "https://www.nj.gov/treasury/taxation",
    guest: true,
    asks: ["SSN", "date of birth"],
    shares: FEDERAL_SPLIT,
    sharesChecked: false,
  },
  MA: {
    portal: "MassTaxConnect",
    url: "https://www.mass.gov/info-details/dor-estimated-tax-payments",
    guest: true,
    asks: [],
    shares: FEDERAL_SPLIT,
    sharesChecked: false,
  },
  GA: {
    portal: "Georgia Tax Center",
    url: "https://georgia.gov/pay-estimated-tax",
    guest: true,
    asks: ["SSN"],
    shares: FEDERAL_SPLIT,
    sharesChecked: true,
  },
  NC: {
    portal: "NCDOR eServices",
    url: "https://www.ncdor.gov",
    // Third parties say yes; not confirmed.
    guest: null,
    asks: [],
    shares: FEDERAL_SPLIT,
    sharesChecked: false,
    note: "No January payment is needed if the return is filed and paid by January 31.",
  },
};
