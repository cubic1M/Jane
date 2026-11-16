import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillsOnward } from "./onward";

// Gate A, the dead-end crawl (11-15): Coming up listed the month's charges with nowhere to go.
describe("Coming up's way onward", () => {
  it("goes to where each charge can be reviewed", () => {
    const html = renderToStaticMarkup(<BillsOnward />);
    expect(html).toContain('href="/subscriptions"');
    expect(html).toContain("Review your regular charges");
  });
});
