import { describe, expect, it } from "vitest";
import { isHiddenPage } from "@/config/hidden-pages";
import type { MultiYearView } from "@/lib/multi-year";
import { retireYearProblem } from "@/lib/multi-year";
import { yearsMoveMessage, yearsReply } from "./multi-year-message";
import { setCountyReply, setRetireYearReply } from "./tax-replies";
import type { MessageAction } from "./types";

const hiddenLinks = (actions: MessageAction[]) =>
  actions.filter((a) => a.kind === "link" && "href" in a && isHiddenPage(a.href));

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

  // Walk 11-26: "See my tax profile" / "See my tax years" opened Taxes, which shows neither the
  // county nor the retirement year (both pages are hidden in the beta).
  it("draws no link to a hidden page on these cards", () => {
    expect(isHiddenPage("/taxes/profile")).toBe(true);
    expect(hiddenLinks(setCountyReply("Travis").actions)).toEqual([]);
    expect(hiddenLinks(setRetireYearReply(2045).actions)).toEqual([]);
    const view = {
      rows: [2026, 2060].map((year) => ({ year, totalTaxCents: 1_000_000, marginalRate: 0.22 })),
      retireYear: 2073,
      retireAssumed: false,
      lifetimeTaxCents: 5_000_000,
      advice: false,
      moves: [],
      assumptions: ["Brackets keep rising with inflation."],
    } as unknown as MultiYearView;
    const reply = yearsReply(view);
    expect(hiddenLinks(reply.actions)).toEqual([]);
    // A retirement year past the last year projected says so, not "(when you retire)".
    expect(reply.body).toContain("2060 (the last year I project; you retire in 2073)");
    const move = { key: "m", title: "Convert", effectCents: 100_000, why: "Why." };
    expect(hiddenLinks(yearsMoveMessage(view, move as never).actions)).toEqual([]);
  });

  it("a retirement year out of range is refused before any card", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(retireYearProblem(2045, now)).toBeNull();
    expect(retireYearProblem(2025, now)).toMatch(/^Give a year from 2026 to /);
    expect(retireYearProblem(2500, now)).toMatch(/^Give a year from 2026 to /);
    expect(retireYearProblem(2040.5, now)).not.toBeNull();
  });

  // Walk 11-26: "Give a year from 2026 to 2060" for a 20-year-old, who is 67 in 2073.
  it("allows a retirement year after 2060, by the person's age when it is known", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(retireYearProblem(2073, now, 20)).toBeNull();
    expect(retireYearProblem(2073, now)).toBeNull();
    // Without an age: a fixed 70 years on.
    expect(retireYearProblem(2096, now)).toBeNull();
    expect(retireYearProblem(2097, now)).toBe("Give a year from 2026 to 2096.");
    // With one: until they are 90 (60 now, so 2056).
    expect(retireYearProblem(2056, now, 60)).toBeNull();
    expect(retireYearProblem(2060, now, 60)).toBe("Give a year from 2026 to 2056.");
    // Past 90, this year only.
    expect(retireYearProblem(2027, now, 95)).toBe("Give a year from 2026 to 2026.");
  });
});
