import type { PolicyKind } from "@/config/insurance";
import type { PremiumFrequency } from "@/config/documents";

// Insurance and renewals from payments (spec step 99): how Jane recognizes an insurer in
// someone's regular payments, what kind of cover it likely is, and the yearly dates it
// works out on its own. Every policy found this way is "found" until the person confirms
// it, and every date is an estimate.

// Regular payments in this category are insurance.
export const INSURANCE_CATEGORIES: readonly string[] = ["GENERAL_SERVICES_INSURANCE"];

// Insurers by the words in their (normalized) merchant name, and the cover they most
// likely are. One not listed but in the insurance category is "other".
// How an insurer's name is written when it isn't just capitalised (the policy found from
// payments is named for the insurer, not the statement's "GEICO AUTO PAYMENT").
export const INSURER_NAMES: Readonly<Record<string, string>> = {
  geico: "GEICO",
  usaa: "USAA",
  metlife: "MetLife",
};

export const INSURER_KINDS: readonly { words: readonly string[]; kind: PolicyKind }[] = [
  {
    words: ["geico", "progressive", "esurance", "root insurance", "the general", "safeco"],
    kind: "auto",
  },
  {
    words: ["state farm", "allstate", "farmers", "liberty mutual", "nationwide", "usaa"],
    kind: "auto",
  },
  { words: ["lemonade", "assurant"], kind: "renters" },
  { words: ["hippo", "openly", "kin insurance"], kind: "home" },
  {
    words: [
      "metlife",
      "haven life",
      "ladder",
      "northwestern mutual",
      "new york life",
      "prudential",
    ],
    kind: "life",
  },
  {
    words: ["trupanion", "healthy paws", "embrace pet", "nationwide pet", "fetch pet"],
    kind: "pet",
  },
  {
    words: ["blue cross", "aetna", "cigna", "kaiser", "united healthcare", "oscar"],
    kind: "health",
  },
];

// A stream's frequency as a premium frequency. Others (weekly, every two weeks) aren't
// premiums.
export const PREMIUM_FREQUENCY_OF: Readonly<Record<string, PremiumFrequency>> = {
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  SEMI_ANNUALLY: "semiannual",
  ANNUALLY: "yearly",
};

// A found policy's term, for the renewal estimate: a year from the first payment seen.
export const FOUND_TERM_MONTHS = 12;
// The first payment seen marks the policy's start only when it comes at least this many days
// after the statements begin; nearer, the payments likely began before them and the renewal
// isn't known (night QA 10-30: with a year of statements, every insurer "renewed" a year
// after the first statement day, "GEICO car insurance renews (estimate) in 19 days", though
// GEICO was a monthly payment that had been going for longer).
export const FOUND_START_SEEN_DAYS = 35;

// Card annual fees: a fee with these words, charged again a year after the last.
export const ANNUAL_FEE_WORDS =
  /\bannual (?:membership )?fee\b|\bannual card fee\b|\byearly fee\b/i;
