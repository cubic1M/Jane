import { describe, expect, it } from "vitest";
import { retireYearProblem } from "@/lib/multi-year";
import { setCountyReply, setRetireYearReply } from "./tax-replies";

// CodeRabbit part 2 (open O27): a county or a retirement year typed in passing is asked about, with
// the answer carried on the card for the yes to save. Nothing is saved by the typing.

describe("typed tax facts ask first", () => {
  it("a county becomes a card with a yes that carries it", () => {
    const reply = setCountyReply("Travis");
    expect(reply.body).toMatch(/^Want me to put Travis County on your tax profile/);
    expect(reply.actions.map((a) => a.id)).toContain("tax.county_set");
    expect(reply.refs.taxCounty).toBe("Travis");
  });

  it("a retirement year becomes a card with a yes that carries it", () => {
    const reply = setRetireYearReply(2045);
    expect(reply.body).toMatch(/^Want me to put 2045 on your tax profile/);
    expect(reply.actions.map((a) => a.id)).toContain("tax.retire_set");
    expect(reply.refs.retireYear).toBe(2045);
  });

  it("a retirement year out of range is refused before any card", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(retireYearProblem(2045, now)).toBeNull();
    expect(retireYearProblem(2025, now)).toMatch(/^Give a year from 2026 to /);
    expect(retireYearProblem(2500, now)).toMatch(/^Give a year from 2026 to /);
    expect(retireYearProblem(2040.5, now)).not.toBeNull();
  });
});
