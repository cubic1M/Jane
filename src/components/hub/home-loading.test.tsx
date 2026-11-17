import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/app-header", () => ({ AppHeaderLoading: () => null }));

import { HomeLoading } from "./home-loading";

// Mobile pass (11-16): on a slow phone Home was a blank page under the header for seconds. While
// it loads it's now the first screen's shape in plain blocks: no words on screen, but still the
// page's loading bar to the code and tests that wait for one, and named for a screen reader.
describe("Home while it loads", () => {
  const html = renderToStaticMarkup(<HomeLoading />);

  it("is the first screen's shape, with no words on screen", () => {
    expect(html.replace(/<[^>]*>/g, "").trim()).toBe("");
    // The net worth card's chart room, as the chart has it: 190 px on a phone, 260 wider.
    expect(html).toContain("h-[190px]");
    expect(html).toContain("sm:h-[260px]");
  });

  it("is still a loading bar, named for a screen reader", () => {
    expect(html).toMatch(
      /role="progressbar"[^>]*aria-label="Loading your hub"[^>]*data-loading-bar=""/,
    );
  });
});
