import { NOT_A_REFUND_MIN_CENTS, NOT_A_REFUND_PRIMARIES } from "@/config/detection";
import { categoryOf, type Category } from "./taxonomy";
import { normalizeDescription } from "@/data-sources/merchant";
import type { NormalizedTransaction } from "@/data-sources/types";
import { BANK_LOANS_INCOME } from "./rule-lists/1-bank-loans-income";
import { RENT_TRANSFERS_EVERYDAY } from "./rule-lists/2-rent-transfers-everyday";
import { FOOD_SHOPS } from "./rule-lists/3-food-shops";
import { HEALTH_TRAVEL_HOME } from "./rule-lists/4-health-travel-home";
import { SHOPS_FUN_GOVERNMENT } from "./rule-lists/5-shops-fun-government";
import { LOANS_AND_LAST } from "./rule-lists/6-loans-and-last";
import type { Direction, Rule } from "./rule-lists/rule";

// Keyword rules come first; only what they can't place goes to the LLM. Order matters:
// the first rule that matches wins, so specific rules (fees, card payments) sit above
// broad merchant ones.

// Split into files so two lanes adding rules don't touch one file, but it's still one list, read in
// this order: the first match wins. Add a rule to the file where it would have sat.
const RULES: readonly Rule[] = [
  ...BANK_LOANS_INCOME,
  ...RENT_TRANSFERS_EVERYDAY,
  ...FOOD_SHOPS,
  ...HEALTH_TRAVEL_HOME,
  ...SHOPS_FUN_GOVERNMENT,
  ...LOANS_AND_LAST,
];

// A bank category ending in "-" is a prefix: American Express writes "Restaurant-Bar & Café".
const bankCategoryMatches = (names: readonly string[], value: string) =>
  names.some((name) => (name.endsWith("-") ? value.startsWith(name) : value === name));

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A keyword this long also matches with a trailing S: a statement drops the apostrophe of a
// possessive ("TRADER JOES" for "Trader Joe's") and a plural is the same merchant. Shorter ones
// (BP, GAP) stay exact: with an S they are other words.
const PLURAL_MIN_LENGTH = 4;

// Whole-word match: "UBER" matches "UBER *TRIP" but not "UBEREATS" or "TUBER".
export function keywordPattern(keywords: readonly string[]): RegExp {
  const alternatives = keywords.map(
    (k) => `${escape(k)}${k.length >= PLURAL_MIN_LENGTH ? "S?" : ""}`,
  );
  return new RegExp(`(?<![A-Z0-9])(?:${alternatives.join("|")})(?![A-Z0-9])`);
}

const COMPILED = RULES.map((rule) => ({
  ...rule,
  pattern: rule.keywords ? keywordPattern(rule.keywords) : (rule.pattern ?? null),
}));

export type RuleInput = Pick<NormalizedTransaction, "description" | "amountCents" | "hints">;

// Pay for work done on one's own (a prop firm's payout, a Stripe or Upwork payout, a
// marketplace's): income, whatever the bank or Claude called it. A bank often files these as a
// transfer in, which isn't income, so "what did I earn from them" found nothing. Null for
// anything else.
const PAYOUTS: readonly string[] = ["INCOME_CONTRACTOR", "INCOME_GIG_ECONOMY"];
export function payoutByRules(t: RuleInput): Category | null {
  if (t.amountCents >= 0) return null;
  const category = categorizeByRules({ ...t, hints: {} });
  return category && PAYOUTS.includes(category.detailed) ? category : null;
}

// Pay the bank filed under something bought: Plaid files "Sweetgreen inc payroll ppd id" under
// restaurants, so a student's weekly $810 netted against what they spent as a refund, and the
// money health score read about 12 cents a month of income (debugger 11-16, a Plaid sandbox
// walk). Money in filed as a transfer, a loan or income stays as filed. Null for anything else.
const FILED_NOT_BOUGHT: readonly string[] = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_DISBURSEMENTS",
  "LOAN_PAYMENTS",
];

export function payFiledAsBought(t: RuleInput, filedPrimary: string | null): Category | null {
  if (t.amountCents >= 0 || filedPrimary === null || FILED_NOT_BOUGHT.includes(filedPrimary)) {
    return null;
  }
  const category = categorizeByRules({ ...t, hints: {} });
  return category?.detailed === "INCOME_SALARY" ? category : null;
}

export function categorizeByRules({ description, amountCents, hints }: RuleInput): Category | null {
  // Bank of America's ACH lines put "DES:" between the company and the entry ("STRIPE
  // DES:TRANSFER", "IRS DES:USATAXPYMT"): read as one phrase, so "STRIPE TRANSFER" is the payout
  // rule, not a transfer (debugger 11-01: a freelancer's $14,086 of Stripe payouts weren't income).
  const text = normalizeDescription(description).replace(/ DES:\s*/g, " ");
  const direction: Direction = amountCents >= 0 ? "out" : "in";

  for (const rule of COMPILED) {
    if (rule.direction && rule.direction !== direction) continue;
    const matched =
      (rule.pattern && rule.pattern.test(text)) ||
      (rule.bankType && hints.bankType && rule.bankType.includes(hints.bankType)) ||
      (rule.bankCategory &&
        hints.bankCategory &&
        bankCategoryMatches(rule.bankCategory, hints.bankCategory));
    if (matched) {
      const category = categoryOf(rule.category);
      const client =
        direction === "in" &&
        category !== null &&
        -amountCents >= NOT_A_REFUND_MIN_CENTS &&
        NOT_A_REFUND_PRIMARIES.includes(category.primary);
      return client ? null : category;
    }
  }
  return null;
}
