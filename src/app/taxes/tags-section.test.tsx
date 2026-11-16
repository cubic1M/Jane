import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TAX_TAG_ORDER } from "@/config/tax";
import type { TaxTagsView } from "@/lib/tax-organizer";
import { tagTotals } from "@/planning/tax-tags";
import { TagsSection } from "./tags-section";

// Debug 2 (11-15, a student with 14 months of statements, 1280 light): Taxes → Records and forms
// → "Tagged for 2026" listed Donation $0.00, Medical $0.00, Childcare $0.00, Education $0.00, Work
// expense $0.00, Business expense $0.00 and Rental expense $0.00. Nothing tagged draws no list
// (taxes-nothing-tagged.test.ts: the tree says it); tags that hold something are listed.

const view = (over: Partial<TaxTagsView> = {}): TaxTagsView => ({
  year: 2026,
  tagged: [],
  totals: tagTotals([]),
  checks: [],
  ...over,
});

describe("Tagged for the year on /taxes", () => {
  it("draws no list of $0.00 when nothing is tagged (the tree's summary says so)", () => {
    const html = renderToStaticMarkup(<TagsSection tags={view()} year={2026} />);
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain("<dl");
    expect(html).toContain('href="/taxes/tags"');
  });

  it("lists only the tags that hold something", () => {
    const totals = tagTotals([]);
    const [first] = TAX_TAG_ORDER;
    totals[first] = { count: 2, totalCents: 4_500 };
    const html = renderToStaticMarkup(<TagsSection tags={view({ totals })} year={2026} />);
    expect(html).toContain("$45.00");
    expect(html).not.toContain("$0.00");
  });
});
