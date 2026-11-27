import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GivingView } from "@/lib/giving";
import type { InvestmentTaxesView } from "@/lib/investment-taxes";
import type { TaxEstimateView } from "@/lib/tax-estimate";

vi.mock("./giving-buttons", () => ({ GivingButton: () => null }));
vi.mock("./actions", () => ({}));
import { GivingSection } from "./giving-section";
import { InvestmentsSection } from "./investments-section";

// CodeRabbit sweep part 6: two things the Taxes page showed that it should not have.

describe("Giving on /taxes", () => {
  const view = (dismissed: boolean) =>
    ({
      year: 2026,
      advice: true,
      gifts: [],
      totalCents: 0,
      yearlyCents: 0,
      options: [{ name: "An option", withCents: 1, withoutCents: 2, savingCents: 1 }],
      receiptsMissing: [],
      fund: null,
      dismissed,
      inSeason: true,
    }) as unknown as GivingView;

  it("hides the options after the person said no to them this year", () => {
    expect(renderToStaticMarkup(<GivingSection view={view(true)} />)).not.toContain(
      "More good for the same money",
    );
    expect(renderToStaticMarkup(<GivingSection view={view(false)} />)).toContain(
      "More good for the same money",
    );
  });
});

describe("Investments on /taxes", () => {
  const view = (soldOutSales: number) =>
    ({
      year: 2026,
      taxableAccounts: 1,
      holdingsKnown: true,
      realisedCents: { shortTerm: 0, longTerm: 0 },
      unrealisedCents: { total: 0, shortTerm: 0, longTerm: 0 },
      washSales: [],
      harvest: [],
      location: [],
      soldOutSales,
    }) as unknown as InvestmentTaxesView;

  it("says when sales of holdings no longer held are not in the realized totals", () => {
    const html = renderToStaticMarkup(
      <InvestmentsSection view={view(2)} estimate={{} as TaxEstimateView} advice={false} />,
    );
    expect(html).toContain("Not counted above: 2 sales in 2026");
    expect(
      renderToStaticMarkup(
        <InvestmentsSection view={view(0)} estimate={{} as TaxEstimateView} advice={false} />,
      ),
    ).not.toContain("Not counted above");
  });
});
