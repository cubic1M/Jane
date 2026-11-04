import { describe, expect, it } from "vitest";
import { CAR_SIGNAL } from "./life-facts";

describe("what counts as a sign of a car", () => {
  // Four "GEICO RENTERS" payments said someone with no car probably drives.
  it.each(["GEICO RENTERS", "STATE FARM HOME", "PROGRESSIVE LIFE INS", "GEICO PET PLAN"])(
    "isn't %s",
    (description) => {
      expect(CAR_SIGNAL.words?.test(description)).toBe(false);
    },
  );

  it.each([
    "GEICO",
    "GEICO AUTO PAYMENT",
    "STATE FARM RO 27 SFPP",
    "PROGRESSIVE AUTOPAY",
    "EZPASS",
  ])("is %s", (description) => {
    expect(CAR_SIGNAL.words?.test(description)).toBe(true);
  });
});
