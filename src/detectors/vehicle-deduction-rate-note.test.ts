import { describe, expect, it } from "vitest";
import { MILEAGE_RATE_NOTE } from "@/config/tax-rates";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { TAX_DETECTORS } from "./taxes";

// CodeRabbit sweep 1c, cfg-03 #5: Jane holds a year's miles with no dates, so it can't price
// miles by the day they were driven; the one rate it uses is said wherever the figure shows.

describe("the mileage deduction says it uses one rate", () => {
  it("carries the note on the vehicle card, with the figure unchanged", () => {
    const data = inputFor("owner");
    const s = runDetectors({ profile: buildProfile(data), data }, TAX_DETECTORS).find(
      (x) => x.topic === "vehicle_deduction",
    )!;
    expect(s.why).toContain(MILEAGE_RATE_NOTE);
    expect(s.why).toMatch(/4,000 miles.*\$2,900\.00/);
  });
});
