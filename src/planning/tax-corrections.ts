import { normalizeMerchant } from "@/data-sources/merchant";
import type { TaxCorrectionKind } from "@/config/tax-set-aside";

// What a person pointed out on their tax calculation, as the estimate uses it. Pure: rows in, one
// summary out. Absent numbers stay null, because "not told" isn't $0.

export type TaxCorrectionRow = {
  id: string;
  kind: string;
  payerKey: string | null;
  label: string;
  cents: number | null;
  paidTo: string | null;
};

export type TaxFixes = {
  notIncome: ReadonlySet<string>;
  wagesCents: number | null;
  selfEmployedCents: number | null;
  withheldCents: number | null;
  businessCostCents: number;
  deductionCents: number;
  paid: { federalCents: number; stateCents: number };
  keptApartCents: number | null;
};

// The key a payer's deposits go by, so a correction reaches their later ones.
export const payerKeyOf = (description: string): string =>
  normalizeMerchant(description)?.key ?? description.trim().toLowerCase();

export function fixesFrom(rows: readonly TaxCorrectionRow[]): TaxFixes {
  const of = (kind: TaxCorrectionKind) => rows.filter((r) => r.kind === kind);
  // The newest, if several ever reach here.
  const one = (kind: TaxCorrectionKind) => of(kind).at(-1)?.cents ?? null;
  const sum = (list: readonly TaxCorrectionRow[]) => list.reduce((s, r) => s + (r.cents ?? 0), 0);
  return {
    notIncome: new Set(of("not_income").flatMap((r) => (r.payerKey ? [r.payerKey] : []))),
    wagesCents: one("wages"),
    selfEmployedCents: one("self_employed"),
    withheldCents: one("withheld"),
    businessCostCents: sum(of("business_cost")),
    deductionCents: sum(of("deduction")),
    paid: {
      federalCents: sum(of("paid").filter((r) => r.paidTo !== "state")),
      stateCents: sum(of("paid").filter((r) => r.paidTo === "state")),
    },
    keptApartCents: one("kept_apart"),
  };
}

// Who paid the income Jane counted, biggest first: what "That isn't income" points at.
export function incomePayers(
  rows: readonly { amountCents: number; description: string; merchantName: string | null }[],
): { key: string; label: string; cents: number }[] {
  const payers = new Map<string, { key: string; label: string; cents: number }>();
  for (const t of rows) {
    if (t.amountCents >= 0) continue;
    const key = payerKeyOf(t.description);
    const payer = payers.get(key);
    if (payer) payer.cents -= t.amountCents;
    else
      payers.set(key, {
        key,
        label: (t.merchantName ?? t.description).trim(),
        cents: -t.amountCents,
      });
  }
  return [...payers.values()].sort((a, b) => b.cents - a.cents);
}
