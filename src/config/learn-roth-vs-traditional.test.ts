import { describe, expect, it } from "vitest";
import { EXPLAINERS } from "./learn";

// CodeRabbit sweep 1c, cfg-02 #1: a traditional IRA's deduction is not promised.

describe("the Roth or traditional article", () => {
  it("keeps the 401(k) treatment apart from the IRA's, which may not be deductible", () => {
    const a = EXPLAINERS.find((x) => x.slug === "roth-vs-traditional")!;
    const text = a.paragraphs.join(" ");
    expect(text).not.toMatch(/401\(k\) or IRA, what you put in lowers/);
    expect(text).toMatch(/traditional IRA contribution may be deductible/);
    expect(text).toMatch(/workplace plan/);
  });

  it("does not say deductible-only tax savings for every traditional account, nor tax basis twice", () => {
    const a = EXPLAINERS.find((x) => x.slug === "roth-vs-traditional")!;
    expect(a.summary).toMatch(/^Deductible traditional/);
    expect(a.paragraphs.join(" ")).not.toMatch(/Either way, you pay income tax/);
    expect(a.paragraphs.join(" ")).toMatch(/not taxed again/);
  });
});
