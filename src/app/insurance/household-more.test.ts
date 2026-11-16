import { describe, expect, it } from "vitest";
import { householdHasMore } from "./household-more";

// Gate A crawl (11-15): the household item's More was an empty list for someone with no policies.
describe("the household item's More", () => {
  it("is there only with plans to compare or a policy to share", () => {
    expect(householdHasMore(0, [])).toBe(false);
    expect(householdHasMore(1, [{ status: "ended" }])).toBe(false);
    expect(householdHasMore(2, [])).toBe(true);
    expect(householdHasMore(0, [{ status: "active" }])).toBe(true);
  });
});
