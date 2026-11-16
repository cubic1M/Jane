import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalcLines } from "./calc-popup";

// Debugger 11-15: Home's "Safe to spend" tile read $2,520 and its "Why this number" sum ended
// "= Safe to spend $2,519", the same $2,519.62 cut off instead of rounded. The sum rounds as the
// tile does.

const render = (cents: number) =>
  renderToStaticMarkup(
    <CalcLines label="Why this number" lines={[{ label: "Safe to spend", sign: "=", cents }]} />,
  );

describe("a sum's lines", () => {
  it("round to the dollar, as the tile does", () => {
    expect(render(251_962)).toContain("$2,520");
    expect(render(251_949)).toContain("$2,519");
  });

  // Gate B: and the parts add up to it, as the tile's total rounds: $1,120.40 − $305.60 read
  // "$1,120 − $306 = $815".
  it("add up to the total they show", () => {
    const html = renderToStaticMarkup(
      <CalcLines
        label="Why this number"
        lines={[
          { label: "In checking", sign: "", cents: 112_040 },
          { label: "Bills before payday", sign: "−", cents: 30_560 },
          { label: "Safe to spend", sign: "=", cents: 81_480 },
        ]}
      />,
    );
    expect(html).toContain("$1,120");
    expect(html).toContain("$305");
    expect(html).not.toContain("$306");
    expect(html).toContain("$815");
  });

  it("keep the minus sign on a shortfall", () => {
    expect(render(-12_350)).toContain("−$124");
  });
});
