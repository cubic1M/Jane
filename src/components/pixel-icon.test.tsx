import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PixelIcon, pixelRuns, type PixelIconName } from "./pixel-icon";

// Icons in square pixels, like the mic (founder: "Icons match it").
describe("pixel icons", () => {
  it("draws each run of pixels in a row as one rectangle", () => {
    expect(pixelRuns(["#.##", "####"])).toEqual([
      [0, 0, 1],
      [2, 0, 2],
      [0, 1, 4],
    ]);
  });

  it("draws every icon square, crisp and in the text colour, hidden from screen readers", () => {
    const names: PixelIconName[] = ["person", "expand", "dock", "collapse", "close", "chevronDown"];
    for (const name of names) {
      const html = renderToStaticMarkup(<PixelIcon name={name} />);
      const [, w, h] = html.match(/viewBox="0 0 (\d+) (\d+)"/) ?? [];
      expect(w, name).toBe(h);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('shape-rendering="crispEdges"');
      expect(html).toContain("fill-current");
      expect(html.match(/<rect/g)?.length ?? 0).toBeGreaterThan(3);
    }
  });
});
