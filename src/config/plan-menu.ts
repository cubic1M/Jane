// The workplace plan's fund menu, used well (spec step 232, demo advice). The menu is read
// from a fee disclosure or statement the person pastes (the same read-then-confirm pattern as
// documents, step 151); nothing is saved until they confirm what Jane read. FOR REVIEW.

export type MenuClass = "us_stocks" | "intl_stocks" | "bonds" | "cash" | "target_date" | "other";

// Words in a fund's name or category that say what it holds, checked in order.
export const CLASS_WORDS: readonly [MenuClass, RegExp][] = [
  ["target_date", /\btarget[- ]?(?:date|retirement)\b|\b20[2-6]\d\b/i],
  ["bonds", /\b(?:bond|fixed income|treasur(?:y|ies)|aggregate|income fund)\b/i],
  ["intl_stocks", /\b(?:international|foreign|global ex|world ex|emerging|overseas|ex[- ]us)\b/i],
  ["cash", /\b(?:stable value|money market|cash|capital preservation)\b/i],
  [
    "us_stocks",
    /\b(?:stock|equity|large|mid|small|index|growth|value|dividend|s&p|total market|blend)\b/i,
  ],
];

// A fund is flagged as costly above this (basis points) when a cheaper one of the same kind
// is on the menu.
export const MENU_COSTLY_BPS = 40;
// A saving under this a year (cents) isn't worth a message.
export const MENU_MIN_SAVING_CENTS = 2_500;
// The account subtypes a plan menu applies to.
export const MENU_SUBTYPES: readonly string[] = ["401k", "403b", "457b"];
export const DEMO_PLAN_NAME = "Demo employer 401(k)";
