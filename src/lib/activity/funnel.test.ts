import { describe, expect, it } from "vitest";
import { computeFunnel, furthestStep } from "./funnel";

describe("the beta funnel", () => {
  it("counts each step among the people who reached the step before", () => {
    const steps = computeFunnel({
      users: ["a", "b", "c", "d"],
      linked: new Set(["a", "b", "c"]),
      // d saw findings without linking (can't happen, but mustn't count).
      sawFindings: new Set(["a", "b", "d"]),
      acted: new Set(["a", "c"]),
    });
    expect(steps).toEqual([
      { name: "Signed up", people: 4, ofPrevious: null },
      { name: "Uploaded or linked", people: 3, ofPrevious: 0.75 },
      { name: "Saw findings", people: 2, ofPrevious: 2 / 3 },
      { name: "Acted on a card", people: 1, ofPrevious: 0.5 },
    ]);
  });

  it("has no rate when no one reached the step before", () => {
    const steps = computeFunnel({
      users: [],
      linked: new Set(),
      sawFindings: new Set(),
      acted: new Set(),
    });
    expect(steps.map((s) => s.ofPrevious)).toEqual([null, null, null, null]);
  });

  it("names the furthest step each person reached", () => {
    const input = {
      users: ["a", "b", "c", "d"],
      linked: new Set(["a", "b", "c"]),
      sawFindings: new Set(["a", "b", "d"]),
      acted: new Set(["a", "c"]),
    };
    expect(["a", "b", "c", "d"].map((id) => furthestStep(id, input))).toEqual([
      "Acted on a card",
      "Saw findings",
      "Uploaded or linked",
      "Signed up",
    ]);
  });
});
