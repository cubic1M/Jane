import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CA_CARE_FERA } from "@/config/utility-assistance";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { UTILITY_DETECTORS } from "./utilities";

// CodeRabbit sweep 1c, cfg-04 #1 and #2: what the utility-assistance cards assume is said, not
// hidden. The Spectrum price may need an extra discount; FERA's household minimum is one config value.
const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";

const internet = (payee: string, cents: number) => {
  const base = inputFor("renter");
  const account = base.accounts[0]!.id;
  const data: ProfileInput = {
    ...base,
    householdSize: 1,
    told: { ...base.told, monthly_income: 200_000 },
    transactions: [
      ...base.transactions.filter(
        (t) => t.pfc !== INTERNET && t.pfc !== "RENT_AND_UTILITIES_TELEPHONE",
      ),
      ...["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({
        date,
        amountCents: cents,
        description: payee,
        pfc: INTERNET,
        accountId: account,
      })),
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }, UTILITY_DETECTORS).find(
    (s) => s.topic === "low_cost_internet",
  );
};

describe("the Spectrum plan's conditional price", () => {
  it("says the $15 may need an extra discount", () => {
    expect(internet("SPECTRUM", 6_500)?.why).toMatch(/may need an additional discount/);
  });

  it("says nothing of the kind for a plan with a plain price", () => {
    const why = internet("COMCAST XFINITY", 7_000)?.why ?? "";
    expect(why).not.toMatch(/additional discount/);
    expect(why).toMatch(/Internet Essentials/);
  });
});

describe("FERA's household minimum", () => {
  it("is the one assumed value, and what it assumes is on file in the config", () => {
    // FOR REVIEW at cpuc.ca.gov/care: whether 1-2 person households qualify for FERA (income
    // between CARE's and FERA's limits) in 2026-27. The detector follows this value.
    expect(CA_CARE_FERA.fera.minPeople).toBe(3);
  });
});
