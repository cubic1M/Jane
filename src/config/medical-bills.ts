// Medical bills (spec step 180): finding them, checking them, and asking for less. Letters
// cite the rules below; each is sent only on the person's tap.

// A medical charge in the last this-many days, of at least this much, counts as a bill.
export const MEDICAL_LOOKBACK_DAYS = 120;
export const MEDICAL_MIN_BILL_CENTS = 10_000;
// Pharmacy and supplies are left out: they're not billed care.
export const MEDICAL_LEFT_OUT = [
  "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
  "MEDICAL_VETERINARY_SERVICES",
];

// Financial assistance is worth asking about at or above this bill.
export const ASSISTANCE_MIN_CENTS = 50_000;
// A payment plan at no interest is offered at or above this, over at most this many months,
// each payment at least the minimum.
export const PLAN_MIN_BILL_CENTS = 30_000;
export const PLAN_MAX_MONTHS = 24;
export const PLAN_MIN_PAYMENT_CENTS = 2_500;

// The rules each kind of letter cites.
export const MEDICAL_RULES = {
  itemized:
    "You have the right to an itemized bill showing each charge and its billing code (CPT or HCPCS).",
  insurance:
    "If you have health insurance, the provider normally must bill it first and you owe only what your plan's explanation of benefits (EOB) says.",
  assistance:
    "Nonprofit hospitals must have a written financial assistance policy and limit what they charge people who qualify (IRS section 501(r)).",
  plan: "Many providers offer payment plans with no interest; you may ask for one in writing before the bill goes to collections.",
} as const;
export const MEDICAL_SOURCE = "https://www.consumerfinance.gov/consumer-tools/medical-debt/";

export const MEDICAL_PARTNER = "demo";
export const MEDICAL_ANSWER_DAYS = 2;
// The provider stand-in's assistance discount, out of 10 (a share of the bill).
export const DEMO_ASSISTANCE_TENTHS = 4;
// How many out of 10 requests it grants.
export const DEMO_GRANT_TENTHS = 8;
