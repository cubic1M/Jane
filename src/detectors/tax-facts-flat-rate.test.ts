import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { TAX_FACT_DETECTORS } from "./tax-facts";

// CodeRabbit sweep 1c, det-04 finding 11: the stock-vest card says the gap holds only if the flat
// rate is what the employer withholds; Jane can't see the actual withholding.

describe("the stock-vest card's flat-rate assumption", () => {
  const data = inputFor("equity");
  const vest = runDetectors(
    { profile: buildProfile(data), data, advice: false },
    TAX_FACT_DETECTORS,
  ).find((s) => s.topic === "stock_vest_tax")!;

  it("is conditional in the title, short and headline", () => {
    expect(vest.title).toMatch(/^If your stock vests are withheld at the flat 22%/);
    expect(vest.short).toContain("if withheld at 22%");
    expect(vest.headline).toMatch(/flat/);
  });

  it("says another withholding method exists and that the actual withholding isn't seen", () => {
    expect(vest.why).toContain("I can't see which yours does, or what was actually withheld");
    expect(vest.why).toContain("if the flat rate is what's withheld");
  });
});
