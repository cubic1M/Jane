import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AreaPage } from "./area-page";

// Debugger 11-13, Plans & goals on a phone: the chip "Return window for West Marine $640 · Nov 13"
// wrapped centred, a button's default, with its figure split over two lines. A chip reads from the
// left like the page, and its figure stays on one line.

const html = renderToStaticMarkup(
  <AreaPage
    tree={{ key: "ahead", label: "Plans & goals", sub: "2 urgent", branches: [] }}
    label="Plans & goals"
    chips={[{ id: "coming:west", label: "Return window for West Marine", figure: "$640 · Nov 13" }]}
    summaries={{}}
    details={{}}
    more={{}}
  />,
);

describe("a chip on an area page", () => {
  it("wraps from the left, with its figure on one line", () => {
    const chip = /<button[^>]*aria-pressed[^>]*>/.exec(html)?.[0] ?? "";
    expect(chip).toMatch(/\btext-left\b/);
    expect(html).toMatch(/<span class="[^"]*\bwhitespace-nowrap\b[^"]*">\$640 · Nov 13<\/span>/);
  });
});
