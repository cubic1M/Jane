import { describe, expect, it } from "vitest";
import { parseWhatIf } from "./what-if-intents";

describe("parseWhatIf", () => {
  it("reads each scenario from a what-if question", () => {
    const cases: [string, string][] = [
      ["what if I lose my job", "job_loss"],
      ["what if i get laid off", "job_loss"],
      ["what if I get a raise", "raise"],
      ["what if we have a baby", "baby"],
      ["what if i move to austin", "moving"],
      ["what if i buy a new car", "car"],
      ["what would happen if i buy a house", "home"],
      ["what if i go part-time", "part_time"],
    ];
    for (const [text, scenario] of cases) {
      expect(parseWhatIf(text), text).toMatchObject({ scenario });
    }
  });

  it("reads how long it lasts", () => {
    expect(parseWhatIf("what if i lose my job for 4 months")).toEqual({
      kind: "what_if",
      scenario: "job_loss",
      months: 4,
    });
    expect(parseWhatIf("what if i lose my job for a year")?.months).toBe(12);
  });

  it("is not a thought experiment unless asked as one", () => {
    expect(parseWhatIf("i lost my job")).toBeNull();
    expect(parseWhatIf("what if i cancel hulu")).toBeNull();
  });
});
