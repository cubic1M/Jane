import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { TWO_DETECTORS } from "./two";

// CodeRabbit sweep 1b: one person with two jobs read as two earners splitting bills.
const [billSplit] = TWO_DETECTORS;
const run = (data: ProfileInput) => billSplit.detect({ profile: buildProfile(data), data });

describe("the bill-split card needs a household of more than one", () => {
  it("fires for the couple", () => {
    expect(run(inputFor("preretire"))?.topic).toBe("bill_split");
  });
  it("not when the same two paychecks belong to a single person", () => {
    const data = inputFor("preretire");
    const single = {
      ...data,
      told: { ...data.told, household: "single" },
    } as unknown as ProfileInput;
    expect(run(single)).toBeNull();
  });
});
