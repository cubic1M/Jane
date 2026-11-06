// Referral partners live in the referral_partners table (edited at /admin/partners). This
// file records the decisions that gate them.

// Counsel's answer on whether insurance referral fees need a license where we operate.
// Insurance partners can't be turned on until `approved` is true; record who answered and
// when, so the decision is on file.
export const COUNSEL_INSURANCE_REFERRALS: {
  approved: boolean;
  recordedOn: string | null;
  note: string;
  // Where counsel approved each way of being paid, by state (connectors roadmap round 14: a flat
  // fee not tied to a sale is allowed in writing in NY, TX, FL, WA and IL; nothing found for CA).
  // Empty: no paid insurance referral anywhere.
  approvedStates: Partial<Record<PayModel, readonly string[]>>;
} = {
  approved: false,
  recordedOn: null,
  note: "Waiting for counsel. Until then insurance_reshop gets quotes only, with no referral fee.",
  approvedStates: {},
};

// How a referral partner pays Jane (round 14). Per sale ("per_policy") is barred for an
// unlicensed referrer in NY, TX, FL, WA and IL and high risk in CA, so it's never allowed for
// insurance. A flat fee or per-quote pay needs counsel's approval for that state.
export const PAY_MODELS = ["none", "flat_click", "flat_lead", "per_quote", "per_policy"] as const;
export type PayModel = (typeof PAY_MODELS)[number];
export const isPayModel = (value: unknown): value is PayModel =>
  typeof value === "string" && (PAY_MODELS as readonly string[]).includes(value);

// Said on the card word for word, next to the partner's own disclosure, so the person knows how
// Jane is paid (round 14, card rule 5). Never one for per sale: it's never shown.
export const PAY_DISCLOSURES: Record<Exclude<PayModel, "per_policy">, string> = {
  none: "Jane isn't an insurance agent and isn't paid for this.",
  flat_click:
    "Jane isn't an insurance agent. Jane gets a flat fee when you click, the same whether or not you buy.",
  flat_lead:
    "Jane isn't an insurance agent. Jane gets a flat fee when you ask for quotes, the same whether or not you buy.",
  per_quote:
    "Jane isn't an insurance agent. Jane gets a flat fee for each quote, the same whether or not you buy.",
};

// US states (and DC) a person can pick on /settings, and partners can be allowed in.
export const US_STATES: readonly { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export const isStateCode = (code: string) => US_STATES.some((s) => s.code === code);
