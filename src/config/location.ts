// The right investment in the right account (spec step 231, demo advice): which accounts
// are tax-advantaged and how each kind of money is best placed. FOR REVIEW.

export type AccountKind = "pre_tax" | "roth" | "taxable";

// Plaid subtypes by how their growth is taxed. HSAs count with Roth: tax-free growth.
export const PRE_TAX_SUBTYPES: readonly string[] = [
  "401k",
  "403b",
  "457b",
  "ira",
  "sep ira",
  "simple ira",
];
export const ROTH_SUBTYPES: readonly string[] = ["roth", "roth 401k", "hsa"];
export const TAXABLE_SUBTYPES: readonly string[] = ["brokerage", "stock plan", "mutual fund"];

// Where each class fits best, in order (the waterfall in src/planning/location.ts):
// interest is taxed as ordinary income each year, so bonds go where that is deferred or free;
// stocks that grow most go where growth is tax-free; foreign stocks get a tax credit in a
// taxable account; US index funds are tax-efficient anywhere.
export const PLACEMENT: Readonly<
  Record<"bonds" | "us_stocks" | "intl_stocks", readonly AccountKind[]>
> = {
  bonds: ["pre_tax", "taxable", "roth"],
  us_stocks: ["roth", "taxable", "pre_tax"],
  intl_stocks: ["taxable", "roth", "pre_tax"],
};
export const PLACEMENT_SOURCE =
  "Common asset-location guidance (Bogleheads, Vanguard): interest where it is deferred, growth where it is free";

// A swap smaller than this isn't worth the trouble (cents).
export const MIN_SWAP_CENTS = 20_000;
// Without a tax estimate: the rates on interest and on long-term gains.
export const DEFAULT_ORDINARY_RATE = 0.22;
export const DEFAULT_GAIN_RATE = 0.15;
// Tax saved a year below this is not worth a message (cents).
export const MIN_SAVING_CENTS = 5_000;
