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
    expect(html).toContain("min-height:190px");
    expect(html).toContain("sm:h-[260px]");
  });

  // A slow phone drew it before the stylesheet came (none at 1.5 s and 3 s): every block is sized
  // and filled in its own style, or it's a blank page again.
  it("keeps its shape before the stylesheet arrives", () => {
    const blocks = html.match(/<div class="[^"]*animate-pulse[^"]*"[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) {
      expect(b).toMatch(/style="[^"]*min-height:\d+px[^"]*background:rgba/);
    }
  });

  it("is still a loading bar, named for a screen reader", () => {
    expect(html).toMatch(
      /role="progressbar"[^>]*aria-label="Loading your hub"[^>]*data-loading-bar=""/,
    );
  });
});
