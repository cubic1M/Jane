import { describe, expect, it } from "vitest";
import {
  READ_ONLY_INSURANCE,
  READ_ONLY_INVESTMENTS,
  READ_ONLY_TAX_CALENDAR,
  READ_ONLY_TAXES,
} from "./read-only-beta";

// What a real account reads about what Jane does: nothing it doesn't do in the read-only beta.
const WORDS = [
  READ_ONLY_INSURANCE.title,
  READ_ONLY_INSURANCE.limit,
  READ_ONLY_INSURANCE.body,
  READ_ONLY_TAXES.title,
  ...READ_ONLY_TAXES.lines,
  READ_ONLY_INVESTMENTS.title,
  ...READ_ONLY_INVESTMENTS.lines,
  READ_ONLY_TAX_CALENDAR,
];

describe("the read-only beta's words", () => {
  it.each(WORDS)("promises nothing Jane doesn't do: %s", (line) => {
    expect(line).not.toMatch(
      /autopilot|on its own|by itself|by myself|your tap|reshop|small claims|filing partner|what I'd change|demo advice|\bI\b/i,
    );
  });

  it("says who does the part Jane doesn't", () => {
    expect(READ_ONLY_TAXES.lines.join(" ")).toMatch(/You file, sign and pay yourself/);
    expect(READ_ONLY_INSURANCE.limit).toMatch(/doesn't buy, change or cancel/);
    expect(READ_ONLY_INVESTMENTS.lines.join(" ")).toMatch(/doesn't trade or move money/);
    expect(READ_ONLY_TAX_CALENDAR).toMatch(/you do each one yourself/);
  });
});
