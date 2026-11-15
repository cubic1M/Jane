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

  it("keep the minus sign on a shortfall", () => {
    expect(render(-12_350)).toContain("−$124");
  });
});
