// Collections and credit report errors (spec step 181): the rules each letter cites and the
// deadlines they set. Every letter takes its rule and its days from here; nothing is sent
// without the person's tap.

// Federal Fair Debt Collection Practices Act, section 809(b): a collector must send a
// validation notice; if the person disputes in writing within this many days of getting it,
// collection must stop until the debt is verified.
export const VALIDATION_WINDOW_DAYS = 30;
// Fair Credit Reporting Act, section 611: a credit bureau must investigate a dispute within
// this many days (45 when the person sends more information during the investigation).
export const BUREAU_INVESTIGATION_DAYS = 30;

export const CREDIT_RULES = {
  validation: {
    name: "the Fair Debt Collection Practices Act, section 809(b) (15 U.S.C. 1692g)",
    text: `I dispute this debt and request validation. Under section 809(b) of the Fair Debt Collection Practices Act (15 U.S.C. 1692g), please stop collection on it until you send me verification: the amount, the original creditor, and proof that I owe it. I am writing within ${VALIDATION_WINDOW_DAYS} days of your first notice.`,
  },
  dispute: {
    name: "the Fair Credit Reporting Act, section 611 (15 U.S.C. 1681i)",
    text: `Under section 611 of the Fair Credit Reporting Act (15 U.S.C. 1681i), I dispute the item below as inaccurate or unverifiable. Please investigate within ${BUREAU_INVESTIGATION_DAYS} days, send me the results in writing, and delete or correct the item if it can't be verified.`,
  },
} as const;
export const CREDIT_FIX_SOURCE =
  "https://www.consumerfinance.gov/ask-cfpb/how-do-i-dispute-an-error-on-my-credit-report-en-314/";

// The medical collection policy the three bureaus follow: unpaid medical collections under
// $500 aren't reported, and paid ones are removed.
export const MEDICAL_COLLECTION_NOTE =
  "The three credit bureaus don't report medical collections under $500, and remove ones that have been paid.";
export const MEDICAL_COLLECTION_FLOOR_CENTS = 50_000;

export const CREDIT_FIX_PARTNER = "demo";
// The stand-in answers after this many days.
export const CREDIT_FIX_ANSWER_DAYS = 3;
// Out of 10, how many collections it removes when validation is asked for; the rest are
// "verified" and stay (an error dispute is always corrected).
export const DEMO_REMOVE_TENTHS = 6;
