import type { PfcDetailed } from "../taxonomy";

export type Direction = "out" | "in";

export type Rule = {
  category: PfcDetailed;
  // Matched against the upper-cased description as whole words.
  keywords?: readonly string[];
  // Only for money leaving (out) or entering (in) the account.
  direction?: Direction;
  bankType?: readonly string[];
  bankCategory?: readonly string[];
  // Matched against the upper-cased description, for a shape no keyword names.
  pattern?: RegExp;
};
