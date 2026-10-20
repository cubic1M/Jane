import { describe, expect, it } from "vitest";
import { GIFT_ANNUAL_EXCLUSION_CENTS } from "@/config/family";
import { childRothRoom, giftOk, percentFunded } from "./family";

// Spec step 213: a child's Roth IRA room, gift amounts, and the progress a gift page shows.

describe("childRothRoom", () => {
  it("is the lower of what they earned and the IRA limit, less what's gone in", () => {
    expect(childRothRoom(300_000, 0)).toBe(300_000);
    expect(childRothRoom(300_000, 100_000)).toBe(200_000);
    expect(childRothRoom(2_000_000, 0)).toBe(750_000);
    expect(childRothRoom(2_000_000, 750_000)).toBe(0);
  });
  it("is nothing without earned income, however much is put in elsewhere", () => {
    expect(childRothRoom(0, 0)).toBe(0);
    expect(childRothRoom(100_000, 300_000)).toBe(0);
  });
});

describe("giftOk", () => {
  it("accepts $5 up to the annual exclusion, whole cents only", () => {
    expect(giftOk(500)).toBe(true);
    expect(giftOk(499)).toBe(false);
    expect(giftOk(GIFT_ANNUAL_EXCLUSION_CENTS)).toBe(true);
    expect(giftOk(GIFT_ANNUAL_EXCLUSION_CENTS + 1)).toBe(false);
    expect(giftOk(12.5)).toBe(false);
    expect(giftOk(Number.NaN)).toBe(false);
  });
});

describe("percentFunded", () => {
  it("is a whole percent, rounded down and capped, so the page never shows an amount", () => {
    expect(percentFunded(0, 1_000_000)).toBe(0);
    expect(percentFunded(333_333, 1_000_000)).toBe(33);
    expect(percentFunded(2_000_000, 1_000_000)).toBe(100);
    expect(percentFunded(5, 0)).toBe(0);
    expect(percentFunded(-5, 100)).toBe(0);
  });
});
