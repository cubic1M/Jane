import { describe, expect, it } from "vitest";
import { SECTORS } from "@/config/autopilot-sectors";
import { byHerself, sectorLine } from "./replies-autopilot";

// One sentence per area for what Jane does by herself, at the area's own level (spec step 141).
// Insurance, investing and taxes end their own "on autopilot" answers and pages with it, so
// they say what mayAct allows (docs/feature-audit.md, cluster 1).

const at = (level: "ask" | "safe" | "all", sector: (typeof SECTORS)[number] = "insurance") => ({
  sector,
  level,
  actionCapCents: 10_000,
  monthlyCapCents: 40_000,
});

describe("byHerself", () => {
  it("says each level plainly, with the caps where Jane acts", () => {
    expect(byHerself(at("ask"))).toBe(
      "Insurance is set to always ask: I don't switch to a cheaper policy with the same cover or change anything else without your tap.",
    );
    expect(byHerself(at("safe", "taxes"))).toBe(
      "Taxes is set to the safe stuff, up to $100.00 each time and $400.00 a month: I only do by myself what can't cost you, and ask you about the rest.",
    );
    expect(byHerself(at("all", "investing"))).toBe(
      "Investing is set to everything allowed: I move money into investing by myself, up to $100.00 each time and $400.00 a month, and ask you about anything over that.",
    );
  });

  it("has a sentence for every area and level, agreeing with the Settings line", () => {
    for (const sector of SECTORS) {
      for (const level of ["ask", "safe", "all"] as const) {
        const said = byHerself(at(level, sector));
        expect(said).toMatch(/^[A-Z].+\.$/);
        expect(sectorLine(at(level, sector)).startsWith(said.split(" is set to")[0])).toBe(true);
      }
    }
  });
});
