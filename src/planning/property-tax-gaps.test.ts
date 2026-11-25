import { describe, expect, it } from "vitest";
import { appealWindow, draftAppeal } from "./property-tax";

describe("an appeal is drafted only from comparable sales", () => {
  it("refuses an empty set instead of asking for a $0 assessment", () => {
    expect(() =>
      draftAppeal({
        year: 2026,
        board: "the County Board",
        address: "1 Main St",
        assessedCents: 50_000_000,
        comps: [],
      }),
    ).toThrow(/comparable/i);
  });
});

describe("a rolled-over fixed window without an opening date", () => {
  it("is upcoming, not open, once this year's deadline has passed", () => {
    const w = appealWindow("NJ", "2026-04-02", null);
    expect(w.closesOn).toBe("2027-04-01");
    expect(w.status).toBe("upcoming");
    expect(w.text).not.toMatch(/you can appeal/i);
    expect(w.text).toContain("Apr 1, 2027");
  });
  it("stays open for a deadline in the current cycle", () => {
    expect(appealWindow("NJ", "2026-03-01", null).status).toBe("open");
    expect(appealWindow("NJ", "2026-04-01", null).status).toBe("open");
  });
});
