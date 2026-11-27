import { describe, expect, it } from "vitest";
import { FAMILY_RULES } from "@/config/family-taxes";
import { childrenOrUnknownAges } from "./family-taxes";

// A child counted under 17 with no recorded age is never taken for under 13: the care credit
// would be worked out, and a "wasn't claimed" finding made, from a guess (CodeRabbit sweep, part 4).
describe("children whose ages Jane was never given", () => {
  it("are under 17 and not under 13, so only the child credit can stand", () => {
    const kids = childrenOrUnknownAges(null, 2);
    expect(kids).toHaveLength(2);
    for (const k of kids) {
      expect(k.ageAtYearEnd).toBeLessThan(FAMILY_RULES.childCreditUnderAge);
      expect(k.ageAtYearEnd).toBeGreaterThanOrEqual(FAMILY_RULES.careUnderAge);
    }
  });

  it("are replaced by the ages the person recorded", () => {
    const told = [{ ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 12 }];
    expect(childrenOrUnknownAges(told, 3)).toEqual(told);
  });
});
