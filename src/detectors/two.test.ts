import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PERSON_IDS } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { TWO_DETECTORS } from "./two";

// Spec step 242: two paychecks that differ a lot, and no split chosen yet.
const [billSplit] = TWO_DETECTORS;
const run = (data: ProfileInput) => billSplit.detect({ profile: buildProfile(data), data });

describe("how a couple splits bills (step 242)", () => {
  it("shows Dan and Lena the split by income, with their own paychecks and bills", () => {
    const s = run(inputFor("preretire"));
    expect(s?.topic).toBe("bill_split");
    expect(s?.headline).toMatch(/^Set bills to 66\/34 by income: \$[\d,]+\/yr$/);
    expect(s?.why).toMatch(/Meridian Logistics pays 66% of what you two earn/);
    expect(s?.worthCents).toBeGreaterThan(0);
    expect(s?.confidence.reason).toMatch(/paychecks? in 12 months of data/);
  });

  it("is quiet once they've chosen, for the Reyes (close to half each) and for singles", () => {
    const data = inputFor("preretire");
    expect(run({ ...data, extras: { ...data.extras!, splitChosen: true } })).toBeNull();
    for (const id of PERSON_IDS.filter((p) => p !== "preretire")) {
      expect(run(inputFor(id)), id).toBeNull();
    }
  });
});
