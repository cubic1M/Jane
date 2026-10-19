import {
  BUSINESS_HINT_CATEGORIES,
  TAX_TAG_ORDER,
  TAX_TAGS,
  UNTAGGED,
  isTaxTagKind,
  type TaxTagKind,
} from "@/config/tax";
import { normalizeMerchant } from "@/data-sources/merchant";

// Tax tags (spec step 119). Pure. Jane tags spending by its category (src/config/tax.ts
// TAX_TAGS); the person's own tag, on one transaction or a whole merchant, always wins. A
// tag sits beside the category and never changes it, so spending totals stay the same.

export type TagTransaction = {
  id: string;
  date: string;
  // Plaid's sign: positive is money out. Only money out is tagged.
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
};

// The person's tags: by transaction id and by merchant key; "none" means not for taxes.
export type TagOverrides = {
  byTransaction: ReadonlyMap<string, string>;
  byMerchant: ReadonlyMap<string, string>;
  // Spec step 123: the person has freelance income, so Jane suggests likely business
  // expenses (and asks about them).
  businessHints?: boolean;
};

export const NO_OVERRIDES: TagOverrides = { byTransaction: new Map(), byMerchant: new Map() };

// "yours": the person tagged it. "jane": from the category, sure. "check": from the
// category, but Jane asks (an online course may not count as education).
export type TagSource = "yours" | "jane" | "check";

export type Tagged = TagTransaction & {
  tag: TaxTagKind;
  source: TagSource;
  merchantKey: string | null;
  payee: string;
};

export const merchantKeyOf = (t: Pick<TagTransaction, "merchantName" | "description">) =>
  normalizeMerchant(t.merchantName ?? t.description)?.key ?? null;

export const payeeOf = (t: Pick<TagTransaction, "merchantName" | "description">) =>
  (t.merchantName ?? t.description).trim();

function automatic(
  t: TagTransaction,
  businessHints: boolean,
): { tag: TaxTagKind; check: boolean } | null {
  if (t.pfcDetailed === null) return null;
  if (businessHints && (BUSINESS_HINT_CATEGORIES as readonly string[]).includes(t.pfcDetailed)) {
    return { tag: "business", check: true };
  }
  for (const tag of TAX_TAG_ORDER) {
    if ((TAX_TAGS[tag].categories as readonly string[]).includes(t.pfcDetailed)) {
      return { tag, check: TAX_TAGS[tag].check };
    }
  }
  return null;
}

// One transaction's tag, or null when it isn't for taxes.
export function tagOf(t: TagTransaction, overrides: TagOverrides): Tagged | null {
  if (t.amountCents <= 0) return null;
  const merchantKey = merchantKeyOf(t);
  const chosen =
    overrides.byTransaction.get(t.id) ??
    (merchantKey ? overrides.byMerchant.get(merchantKey) : undefined);
  const base = { ...t, merchantKey, payee: payeeOf(t) };
  if (chosen !== undefined) {
    return chosen !== UNTAGGED && isTaxTagKind(chosen)
      ? { ...base, tag: chosen, source: "yours" }
      : null;
  }
  const auto = automatic(t, overrides.businessHints ?? false);
  return auto ? { ...base, tag: auto.tag, source: auto.check ? "check" : "jane" } : null;
}

export function tagAll(transactions: TagTransaction[], overrides: TagOverrides): Tagged[] {
  return transactions
    .flatMap((t) => {
      const tagged = tagOf(t, overrides);
      return tagged ? [tagged] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export type TagTotals = Record<TaxTagKind, { count: number; totalCents: number }>;

export function tagTotals(tagged: Tagged[]): TagTotals {
  const totals = Object.fromEntries(
    TAX_TAG_ORDER.map((tag) => [tag, { count: 0, totalCents: 0 }]),
  ) as TagTotals;
  for (const t of tagged) {
    totals[t.tag].count += 1;
    totals[t.tag].totalCents += t.amountCents;
  }
  return totals;
}

// The merchants Jane is unsure about, most spent first: one question each.
export type TagCheck = {
  merchantKey: string;
  payee: string;
  tag: TaxTagKind;
  count: number;
  totalCents: number;
};

export function tagChecks(tagged: Tagged[]): TagCheck[] {
  const byMerchant = new Map<string, TagCheck>();
  for (const t of tagged) {
    if (t.source !== "check" || !t.merchantKey) continue;
    const check = byMerchant.get(t.merchantKey) ?? {
      merchantKey: t.merchantKey,
      payee: t.payee,
      tag: t.tag,
      count: 0,
      totalCents: 0,
    };
    check.count += 1;
    check.totalCents += t.amountCents;
    byMerchant.set(t.merchantKey, check);
  }
  return [...byMerchant.values()].sort(
    (a, b) => b.totalCents - a.totalCents || a.merchantKey.localeCompare(b.merchantKey),
  );
}
