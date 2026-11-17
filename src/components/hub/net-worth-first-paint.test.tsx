import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NetWorthChart } from "./net-worth-chart";

// Mobile pass (founder, 11-16). What the server sends is what a slow phone shows until the page
// wakes, and it drew the chart for a 640 px screen: 260 px tall and past the card's edge. The
// server's chart is marked not yet measured, which keeps it out of sight at the height it will
// have on that screen (190 px on a phone) until it knows its width.

const points = [
  { date: "2026-10-01", cents: 120_000 },
  { date: "2026-10-15", cents: 135_000 },
  { date: "2026-11-01", cents: 128_000 },
];

describe("the net worth chart before the page wakes", () => {
  it("is marked not yet measured", () => {
    const html = renderToStaticMarkup(<NetWorthChart points={points} />);
    expect(html).toMatch(/<div[^>]*class="nw-area[^"]*"[^>]*data-unmeasured=""/);
    expect(html).toMatch(/<div[^>]*data-net-worth-plot=""[^>]*data-unmeasured=""/);
  });

  it("which keeps it out of sight, at a phone's height on a phone", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.nw-box\[data-unmeasured\]\s*\{\s*visibility: hidden;/);
    expect(css).toMatch(/\.nw-box\[data-unmeasured\]\s*\{\s*height: 190px !important;/);
  });
});
