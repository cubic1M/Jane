// Investing for the family (spec step 213, demo advice): a child's custodial account, a Roth
// IRA for a teenager with earned income, and gifts into a child's college fund through a
// share link. FOR REVIEW: ESTIMATE TO VERIFY each year.

// A Roth IRA for a child: they can put in the lower of what they earned and the IRA limit
// (src/config/retirement.ts). Anyone, including a parent, can supply the money.
export const CHILD_ROTH_SOURCE =
  "IRS: the contribution can't exceed the child's earned income or the IRA limit";
export const CHILD_ROTH_MIN_AGE = 14;

// Custodial accounts (UTMA/UGMA): the money is the child's. A child's unearned income above
// this much a year is taxed at the parents' rate (the "kiddie tax"), 2026.
export const KIDDIE_TAX_THRESHOLD_CENTS = 270_000;
export const KIDDIE_TAX_SOURCE = "IRS Form 8615 (kiddie tax threshold, 2026); ESTIMATE TO VERIFY";
export const CUSTODIAL_NOTE =
  "A custodial account belongs to the child: it can't be taken back, and it counts more against financial aid than a parent's 529.";
export const CUSTODIAL_FUND = "KTSIX";

// Gifts: the most one person can give a child in a year without filing a gift tax return.
export const GIFT_ANNUAL_EXCLUSION_CENTS = 1_900_000;
export const GIFT_EXCLUSION_SOURCE = "IRS annual gift tax exclusion, 2026; ESTIMATE TO VERIFY";
// A link takes at most this many gifts, each at most the exclusion.
export const GIFT_MAX_PER_LINK = 25;
export const GIFT_MIN_CENTS = 500;

export const TOKEN_BYTES = 18;
