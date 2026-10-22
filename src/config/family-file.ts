// The family looked after (spec step 237): beneficiaries checked on every account that takes
// them, transfer-on-death where an account allows it, and a file of what the family would need
// that the person shares in part. Wills and trusts get facts and a door to a lawyer, never legal
// advice: the sentences in ESTATE_FACTS and ESTATE_POINTER are reviewed wording, and
// src/lib/guardrails.ts lets exactly these through and blocks everything else of that kind.

// Account subtypes that name beneficiaries on a form (the rest of the account passes by the
// will if none is named). Plaid subtypes, lower case.
export const BENEFICIARY_SUBTYPES: readonly string[] = [
  "401k",
  "403b",
  "457b",
  "ira",
  "roth",
  "roth 401k",
  "hsa",
  "annuity",
];
// Accounts that can be set up to pass to a named person outside a will, where the institution
// allows it (transfer-on-death on a brokerage, payable-on-death at a bank).
export const TOD_SUBTYPES: readonly string[] = ["brokerage", "savings", "checking", "cd"];

// What happens in a person's life that makes old beneficiaries wrong.
export const BENEFICIARY_EVENTS = {
  marriage: "Got married",
  divorce: "Got divorced",
  birth: "Had a child",
} as const;
export type BeneficiaryEvent = keyof typeof BENEFICIARY_EVENTS;

export const RELATIONSHIPS = ["spouse", "child", "parent", "sibling", "other"] as const;

// Shares of the primary beneficiaries on an account must add up to this.
export const FULL_SHARE = 100;

// What the file can hold. The person picks which of these to share; nothing else is in it.
export const FILE_SECTIONS = {
  accounts: "Where my accounts are (names and last four digits, never balances or logins)",
  beneficiaries: "Who I have named on each account",
  contacts: "People to call (lawyer, accountant, executor, family)",
  documents: "Where my documents are kept",
} as const;
export type FileSection = keyof typeof FILE_SECTIONS;

// Reviewed wording about wills and trusts. Facts, no advice on what to choose.
export const ESTATE_FACTS: readonly string[] = [
  "A will says who gets what you own when you die, and a court usually has to approve it.",
  "A trust holds property for people you name, and it can pass outside of court.",
  "An account with a named beneficiary passes to that person whatever your will says.",
  "The rules differ by state.",
];
export const ESTATE_POINTER =
  "For a will, a trust or any question of what to do, an estate-planning attorney in your state is the right person to ask.";

// Every sentence the guardrails let through.
export const APPROVED_FAMILY_SENTENCES: readonly string[] = [...ESTATE_FACTS, ESTATE_POINTER];

export const FILE_DISCLAIMER =
  "This file lists facts Jane found or you typed. It is not a legal document and doesn't change who gets what.";
