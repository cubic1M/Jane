import {
  CARD_CATALOG,
  CONDITION_WORDS,
  type CardBenefit,
  type CardBenefitKind,
  type CardProduct,
} from "@/config/card-benefits";
import { formatCents } from "@/lib/money";

// Which of the person's cards come with cover (spec step 152), from a card-benefits
// catalog. Until a data partner is connected (env CARD_BENEFITS_PARTNER), the stand-in
// reads src/config/card-benefits.ts, reviewed by our team; its demo card only matches the
// demo bank's card. Pure.

export type CardAccount = { id: string; name: string; type: string; demo: boolean };

export interface CardBenefitsCatalog {
  productFor(account: CardAccount): CardProduct | null;
}

export const standInCatalog: CardBenefitsCatalog = {
  productFor: ({ name, type, demo }) =>
    type === "credit"
      ? (CARD_CATALOG.find((p) => p.match.test(name.trim()) && (!p.demo || demo)) ?? null)
      : null,
};

// Only the stand-in exists today; a partner is added behind the same interface.
export function cardCatalog(): CardBenefitsCatalog {
  return standInCatalog;
}

export const productById = (id: string) => CARD_CATALOG.find((p) => p.id === id) ?? null;

export const benefitOf = (product: CardProduct, kind: CardBenefitKind) =>
  product.benefits.find((b) => b.kind === kind) ?? null;

// Account id to the catalog product it matches, for the detection rules.
export function cardProducts(accounts: CardAccount[], catalog = cardCatalog()) {
  const products: Record<string, string> = {};
  for (const account of accounts) {
    const product = catalog.productFor(account);
    if (product) products[account.id] = product.id;
  }
  return products;
}

// Pure: a benefit's limits in words: "Up to $800.00 a claim, Deductible $50.00, Claims a
// year 2".
export function limitWords(benefit: Pick<CardBenefit, "limits">): string {
  return benefit.limits
    .map((l) =>
      [l.label, l.cents === null ? null : formatCents(l.cents), l.text].filter(Boolean).join(" "),
    )
    .join(", ");
}

export const conditionWords = (benefit: Pick<CardBenefit, "condition">) =>
  CONDITION_WORDS[benefit.condition];
