// Sudden money (spec step 235, demo advice): a bonus, an inheritance or a sale, with a staged
// plan. The tax set-aside comes first and is figured by kind. FOR REVIEW: ESTIMATE TO VERIFY.

export type SuddenKind = "bonus" | "inheritance" | "home_sale" | "other_sale" | "gift";

export const SUDDEN_KINDS: Readonly<Record<SuddenKind, string>> = {
  bonus: "A bonus",
  inheritance: "An inheritance",
  home_sale: "Selling a home",
  other_sale: "Selling something else (stocks, a business)",
  gift: "A gift",
};

// A deposit this big that isn't pay gets asked about, once.
export const SUDDEN_MIN_CENTS = 500_000;
// Look back this many days for new ones.
export const SUDDEN_LOOKBACK_DAYS = 45;
// Deposits in these Plaid categories are pay, transfers or refunds, not sudden money.
export const NOT_SUDDEN_DETAILED: readonly string[] = [
  "INCOME_SALARY",
  "INCOME_WAGES",
  "INCOME_TAX_REFUND",
  "INCOME_UNEMPLOYMENT",
  "INCOME_RETIREMENT_PENSION",
];
export const NOT_SUDDEN_PRIMARY: readonly string[] = ["TRANSFER_IN", "LOAN_DISBURSEMENTS"];

// How each kind is taxed, with sources. A bonus is paid with 22% federal tax already taken
// out (IRS supplemental wage rate); the rest of the tax owed is the person's marginal rate
// less that. An inheritance isn't income to the person who gets it (IRS Pub. 559) unless it's
// a retirement account. A home sale's gain is tax-free up to $250,000 ($500,000 jointly) if
// it was lived in 2 of the last 5 years (IRC §121). Other sales are taxed on the gain, long
// term when held over a year. Gifts aren't income to the receiver.
export const SUPPLEMENTAL_WITHHOLDING = 0.22;
export const HOME_SALE_EXCLUSION_CENTS = { single: 25_000_000, married_joint: 50_000_000 } as const;
// Without the cost basis, Jane assumes this share of a sale's proceeds is gain, and says so.
export const ASSUMED_GAIN_SHARE = 0.5;
export const TAX_SOURCES: Readonly<Record<SuddenKind, string>> = {
  bonus: "IRS supplemental wage withholding (22%); the rest at your marginal rate",
  inheritance:
    "IRS Publication 559: an inheritance isn't taxable income to you (an inherited retirement account is different)",
  home_sale:
    "IRC §121: up to $250,000 ($500,000 jointly) of gain is tax-free on a home you lived in",
  other_sale:
    "Long-term capital gains rates on the gain; Jane assumes half the proceeds is gain unless you tell it",
  gift: "IRS: a gift isn't income to the person who receives it",
};

// Card and loan debts at or above this rate are paid off before investing.
export const HIGH_INTEREST_APR_BPS = 800;
// Left for investing or goals below this, a stage is skipped (cents).
export const MIN_STAGE_CENTS = 5_000;
export const SUDDEN_DEMO = {
  amountCents: 1_200_000,
  description: "ACME CORP ANNUAL BONUS",
} as const;
