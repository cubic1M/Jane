import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTOR_RATES as R } from "@/config/detectors";
import { PERSON_IDS } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { FIGURES_DETECTORS } from "./figures";

// Spec step 239: a headline figure that rests on something only the person knows.
const [businessIncome] = FIGURES_DETECTORS;
const run = (data: ProfileInput) => businessIncome.detect({ profile: buildProfile(data), data });

describe("a figure worth correcting (step 239)", () => {
  it("tells Jo her shop's sales are counted as her income", () => {
    const data = inputFor("owner");
    const deposits = buildProfile(data).facts.monthly_income.value as number;
    const s = run(data);
    expect(s?.topic).toBe("figure_check");
    expect(s?.worthCents).toBe(Math.round(deposits * (1 - R.tax.businessProfitShare)));
    expect(s?.why).toMatch(/sales/);
    expect(s?.confidence.percent).toBeGreaterThanOrEqual(90);
    expect(s?.action.href).toBe("/figures/monthly_income");
  });

  it("is quiet once she's said what she takes home", () => {
    expect(run(inputFor("owner", { monthly_income: 600_000 }))).toBeNull();
  });

  it("is quiet for people paid a wage, a pension or uneven pay", () => {
    for (const id of PERSON_IDS.filter((p) => p !== "owner")) {
      expect(run(inputFor(id)), id).toBeNull();
    }
  });
});
