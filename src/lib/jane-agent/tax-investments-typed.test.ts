import { describe, expect, it } from "vitest";
import type { InvestmentTaxesView } from "@/lib/investment-taxes";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { investmentsReply } from "./tax-investments";

// Debug 2, fifth desktop sweep (11-17, Plaid sandbox checking sending $500 a month to Fidelity):
// after the person typed their Fidelity balance ($1,560) on the Investments page, Taxes showed
// "Realized in 2026 $0.00 … Not yet sold $0.00, from the cost basis your broker reports", and the
// chat would say the same. No broker reported anything: what's in the account isn't known, so its
// gains are unknown, not $0.

const view = (holdingsKnown: boolean) =>
  ({
    year: 2026,
    taxableAccounts: 1,
    holdingsKnown,
    unrealised: [],
    unrealisedCents: { total: 0, shortTerm: 0, longTerm: 0 },
    realised: [],
    realisedCents: { shortTerm: 0, longTerm: 0 },
    washSales: [],
    harvest: [],
    location: [],
    soldOutSales: 0,
  }) as InvestmentTaxesView;

const estimate = {} as TaxEstimateView;

describe("investment taxes for a balance the person typed", () => {
  it("says the gains aren't known, not $0", () => {
    const body = investmentsReply(view(false), estimate, false).body;
    expect(body).toBe(
      "I don't know what's in your taxable investment account yet, so I can't count its gains or losses. A positions download from your broker, on the Investments page, lets me.",
    );
  });

  it("counts from the cost basis once holdings are known", () => {
    expect(investmentsReply(view(true), estimate, false).body).toMatch(
      /^In 2026 so far you've realised \$0\.00 of gains/,
    );
  });
});
