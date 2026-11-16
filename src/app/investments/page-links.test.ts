import { describe, expect, it } from "vitest";
import { investingPageLinks } from "./page-links";

// Gate A, the dead-end crawl (11-15): a real account's Investing page linked "Practice portfolio",
// whose page says it's only in demo advice mode.
describe("the Investing page's links", () => {
  it("offer the practice portfolio only where it opens", () => {
    expect(investingPageLinks(true).map((l) => l.href)).toContain("/investments/practice");
    expect(investingPageLinks(false).map((l) => l.href)).not.toContain("/investments/practice");
    // The rest are hidden in the read-only beta (src/config/hidden-pages.ts): no row at all then.
    expect(investingPageLinks(false).every((l) => l.href !== "/investments/practice")).toBe(true);
  });
});
