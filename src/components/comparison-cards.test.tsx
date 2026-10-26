import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/compare-actions", () => ({ pickCompared: vi.fn() }));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { toComparison } from "@/lib/comparison";
import type { CardOption, OfferedOptions } from "@/lib/option-card";
import { ComparisonCards } from "./comparison-cards";

// The comparison cards as first drawn: sorted by the preference that opens, each card with its
// tags, its monthly figure and its rows, the rows that differ marked and the rest dimmed.

const option = (id: string, monthly: number, total: number, months: number): CardOption => ({
  id,
  label: id,
  headline: `${id} 7%, $${monthly / 100} a month`,
  priceCents: monthly,
  pricePeriod: "month",
  facts: [],
  whyThisOne: `Why ${id}.`,
  isPick: id === "Lakeside",
  ...(id === "Lakeside" ? { confidence: { percent: 70, reason: "your income" } } : {}),
  details: [],
  compare: {
    monthlyCents: monthly,
    totalCents: total,
    coverScore: null,
    payoffMonths: months,
    rows: [
      { key: "term", label: "Term", value: `${months} months` },
      { key: "fees", label: "Fees", value: "none" },
    ],
    bestFor: `Best for ${id}`,
  },
});

const card: OfferedOptions = {
  kind: "loan",
  title: "Your options for a refinance",
  topic: "refinance",
  newCover: false,
  advice: true,
  options: [option("Lakeside", 40_000, 1_400_000, 48), option("Harbor", 30_000, 1_600_000, 72)],
};

const html = renderToStaticMarkup(<ComparisonCards comparison={toComparison(card)!} />);

describe("ComparisonCards", () => {
  it("draws the options side by side under a preference to sort by", () => {
    expect(html).toContain('aria-label="Your options for a refinance"');
    expect(html).toContain("Sort by");
    for (const label of ["Lowest total cost", "Lowest monthly", "Fastest payoff"]) {
      expect(html).toContain(label);
    }
    // Opens on lowest total, which puts its pick first.
    expect(html).toMatch(/checked="" value="lowest_total"/);
    expect(html.indexOf('data-option-id="Lakeside"')).toBeLessThan(
      html.indexOf('data-option-id="Harbor"'),
    );
  });

  it("shows each card's tags, figure, rows and who it's best for", () => {
    expect(html).toContain("JANE&#x27;S PICK");
    expect(html).toContain('data-tag="LOWEST TOTAL"');
    expect(html).toContain('data-tag="LOWEST MONTHLY"');
    expect(html).toContain("$400");
    expect(html).toContain("» Best for Harbor");
  });

  it("marks the rows that differ and dims the ones that don't", () => {
    expect(html).toMatch(/data-row="term" data-differs=""/);
    expect(html).not.toMatch(/data-row="fees" data-differs/);
    expect(html).toContain("(same on every option)");
  });

  it("has one tap to choose, the reasoning behind More details, and the demo label", () => {
    expect(html).toContain('aria-label="Choose Lakeside"');
    expect(html).toContain("More details");
    expect(html).toContain("70% sure:");
    expect(html).toContain(DEMO_ADVICE_LABEL);
  });
});
