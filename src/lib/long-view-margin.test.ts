import { describe, expect, it } from "vitest";
import { monthlyMargin } from "./long-view";

// CodeRabbit sweep 1b: an income with unknown spending read as spending $0, so the long view
// projected the whole income as monthly saving (and half of it as invested).
describe("monthlyMargin", () => {
  it("is income less spending, never below zero", () => {
    expect(monthlyMargin(400_000, 300_000)).toBe(100_000);
    expect(monthlyMargin(300_000, 400_000)).toBe(0);
  });
  it("is unknown, not the whole income, when spending isn't known", () => {
    expect(monthlyMargin(400_000, null)).toBeNull();
    expect(monthlyMargin(null, 300_000)).toBeNull();
  });
});
