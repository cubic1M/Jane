import { describe, expect, it } from "vitest";
import {
  THIN_DATA_MAX_PERCENT,
  THIN_DATA_MAX_PER_MONTH,
  THIN_DATA_MONTHS,
} from "@/config/detection";
import { CONFIDENCE } from "@/config/profile";
import { confidenceOf } from "./confidence";

describe("confidenceOf", () => {
  it("grows with months and matches, up to its source's cap", () => {
    expect(confidenceOf("seen", { months: 12, matches: 4 })).toBe(45 + 36 + 8);
    expect(confidenceOf("seen", { months: 24, matches: 20 })).toBe(CONFIDENCE.seen.max);
    expect(confidenceOf("told", { months: 0, matches: 0 })).toBe(100);
  });

  // Messy-bank QA: three months of data with four matches read as 62% sure.
  it("stays modest on a few months of data, however many matches", () => {
    for (let months = 0; months < THIN_DATA_MONTHS; months += 1) {
      expect(confidenceOf("seen", { months, matches: 10 })).toBe(
        THIN_DATA_MAX_PERCENT + months * THIN_DATA_MAX_PER_MONTH,
      );
    }
    expect(confidenceOf("seen", { months: 3, matches: 4 })).toBe(59);
    // A guess was already below the cap.
    expect(confidenceOf("guessed", { months: 3, matches: 4 })).toBe(15 + 6 + 8);
    // From THIN_DATA_MONTHS on, the usual sum.
    expect(confidenceOf("seen", { months: THIN_DATA_MONTHS, matches: 10 })).toBe(
      Math.min(CONFIDENCE.seen.max, 45 + THIN_DATA_MONTHS * 3 + 20),
    );
  });
});
