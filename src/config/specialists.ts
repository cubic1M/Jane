import type { Sector } from "@/config/autopilot-sectors";

// The specialists Jane works through: one list of who does what. Each sector keeps its own interface
// (src/lib/money-movement/partner.ts and the rest); this is only the map, and the permission check
// (src/lib/permission/check.ts) reads it. All stand-ins today: nothing real happens. A specialist
// goes "real" here only with a licensed partner connected, and with its flag below on.

export const SPECIALIST_KEYS = [
  "money_movement",
  "brokerage",
  "payroll",
  "filing",
  "tax_payments",
  "tax_documents",
  "credit_report",
  "credit_cards",
  "lenders",
  "insurance",
  "donor_fund",
  "property_records",
  "market_data",
  "email_agent",
  "phone_agent",
] as const;
export type SpecialistKey = (typeof SPECIALIST_KEYS)[number];

export type SpecialistInfo = {
  key: SpecialistKey;
  label: string;
  // What it does for the person, in a line.
  does: string;
  sector: Sector;
  // "acts" changes something outside Jane and must pass the permission check; "reads" only looks.
  access: "acts" | "reads";
  // "stand_in": nothing real happens, for the demo bank and sample people. "real": a licensed
  // partner is connected. None is real yet.
  kind: "stand_in" | "real";
  // Who would hold the license once real, for the map to counsel.
  licenseHolder: string;
};

export const SPECIALISTS: readonly SpecialistInfo[] = [
  {
    key: "money_movement",
    label: "Money movement",
    does: "Pays bills and moves cash between the person's own accounts.",
    sector: "bills",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A licensed money-movement partner",
  },
  {
    key: "brokerage",
    label: "Brokerage",
    does: "Places investment orders.",
    sector: "investing",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A brokerage with a registered adviser",
  },
  {
    key: "payroll",
    label: "Payroll",
    does: "Asks for a change to a retirement contribution at work.",
    sector: "investing",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A payroll partner",
  },
  {
    key: "filing",
    label: "Tax filing",
    does: "Files a tax return or an amendment the person signed.",
    sector: "taxes",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "An embedded filing partner",
  },
  {
    key: "tax_payments",
    label: "Tax payments",
    does: "Pays an estimated tax payment.",
    sector: "taxes",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A licensed tax payment partner",
  },
  {
    key: "tax_documents",
    label: "Tax documents",
    does: "Fetches tax forms.",
    sector: "taxes",
    access: "reads",
    kind: "stand_in",
    licenseHolder: "A tax document partner",
  },
  {
    key: "credit_report",
    label: "Credit report",
    does: "Reads a credit score and report with a soft pull.",
    sector: "debt",
    access: "reads",
    kind: "stand_in",
    licenseHolder: "A bureau or licensed score provider",
  },
  {
    key: "credit_cards",
    label: "Credit cards",
    does: "Applies for a card the person picked.",
    sector: "debt",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A card marketplace partner",
  },
  {
    key: "lenders",
    label: "Lenders",
    does: "Applies for a loan the person picked, and accepts it on their tap.",
    sector: "debt",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A lending marketplace partner",
  },
  {
    key: "insurance",
    label: "Insurance",
    does: "Binds a new policy and cancels the old one.",
    sector: "insurance",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A licensed insurance producer",
  },
  {
    key: "donor_fund",
    label: "Donor-advised fund",
    does: "Opens a donor-advised fund.",
    sector: "taxes",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "A donor-advised fund sponsor",
  },
  {
    key: "property_records",
    label: "Property records",
    does: "Reads a home's value and tax records.",
    sector: "goals",
    access: "reads",
    kind: "stand_in",
    licenseHolder: "A property data provider",
  },
  {
    key: "market_data",
    label: "Market data",
    does: "Reads prices for sample portfolios.",
    sector: "investing",
    access: "reads",
    kind: "stand_in",
    licenseHolder: "A market data provider",
  },
  {
    key: "email_agent",
    label: "Email agent",
    does: "Emails a company to cancel, ask for a refund or dispute a charge, and reads the reply.",
    sector: "bills",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "Jane, under agency wording counsel writes",
  },
  {
    key: "phone_agent",
    label: "Phone agent",
    does: "Calls a company to negotiate a bill.",
    sector: "bills",
    access: "acts",
    kind: "stand_in",
    licenseHolder: "Jane, under agency wording counsel writes",
  },
];

export const specialistInfo = (key: SpecialistKey): SpecialistInfo =>
  SPECIALISTS.find((s) => s.key === key)!;

// The most one yes may commit, in cents. A standing limit has the person's own caps instead
// (src/lib/sector-autopilot.ts). FOR REVIEW: the real one has no partner or counsel behind it yet.
export const YES_CAP_CENTS = { stand_in: 100_000_000, real: 500_000 } as const;
