import { describe, expect, it } from "vitest";
import type { Cushion } from "@/detectors/money";
import { EMPTY_GOAL, cushionDraft } from "./draft";

// Debug 2, 11-22: "Build an emergency cushion, protect $3,875" opened a goal form holding "$5,400 by
// Nov 2027", or nothing, and the $3,875 was nowhere on the page. S6's cushion: $1,778.56 a month,
// $1,412.22 kept, 3 months is $5,335.68.
const s6: Cushion = {
  spend: 177_856,
  cash: 141_222,
  income: null,
  target: {
    kind: "months",
    targetCents: 533_568,
    months: 3,
    targetMonths: 12,
    name: "Emergency fund",
  },
  short: 392_346,
};

describe("the cushion card's goal page", () => {
  it("says the card's figure, its working, and the goal rounded up", () => {
    const { values, line } = cushionDraft(s6, EMPTY_GOAL, "2026-11-22");
    expect(values).toMatchObject({
      name: "Emergency fund",
      target: "5400.00",
      targetDate: "2027-11-22",
    });
    expect(line).toBe(
      "$3,923.46 short of a cushion. You spend about $1,778.56 a month. You keep $1,412.22 in cash; 3 months is $5,335.68. The goal below is $5,335.68, rounded up to $5,400.00.",
    );
  });

  it("keeps Jane's proposal in the form, and says so when it isn't the cushion rounded", () => {
    const proposed = {
      ...EMPTY_GOAL,
      name: "Emergency fund",
      target: "5700.00",
      targetDate: "2027-11-22",
    };
    const { values, line } = cushionDraft(s6, proposed, "2026-11-22");
    expect(values).toBe(proposed);
    expect(line).toMatch(
      /3 months is \$5,335\.68\. The goal below is Jane's proposal, \$5,700\.00\.$/,
    );
  });
});
