import { describe, expect, it } from "vitest";
import { isOverdue } from "./business-days";

describe("isOverdue", () => {
  it("allows one business day, skipping weekends", () => {
    const friday = new Date("2026-10-16T15:00:00Z");

    expect(isOverdue(friday, 1, new Date("2026-10-18T15:00:00Z"))).toBe(false); // Sunday
    expect(isOverdue(friday, 1, new Date("2026-10-19T14:00:00Z"))).toBe(false); // Monday, before
    expect(isOverdue(friday, 1, new Date("2026-10-19T16:00:00Z"))).toBe(true);
  });
});
