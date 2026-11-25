import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTOR_RATES as R } from "@/config/detectors";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { INSURANCE_DETECTORS } from "./insurance";

// CodeRabbit sweep 1c, det-02 finding 1: premiums seen over some months were treated as a year's.
// Three monthly premiums of $100 made the health card's saving from $300, not $1,200, and two years
// of them made it from $2,400.
const health = INSURANCE_DETECTORS.find((d) => d.topic === "health_insurance")!;
const base = inputFor("freelancer");
const account = base.accounts.find((a) => a.type === "depository")!.id;
const monthsBack = (n: number) => {
  const d = new Date(`${base.today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(5);
  return d.toISOString().slice(0, 10);
};
const premium = (n: number, i: number) => ({
  id: `h${i}`,
  date: monthsBack(n),
  amountCents: 10_000,
  description: "BLUE CROSS PREMIUM",
  pfc: "GENERAL_SERVICES_INSURANCE",
  accountId: account,
});
const withPremiums = (months: number[], keepOlder = true): ProfileInput => {
  const since = monthsBack(Math.max(...months) + 1);
  return {
    ...base,
    transactions: [
      ...base.transactions.filter(
        (t) =>
          !/BLUE CROSS|HEALTHCARE|MARKETPLACE|AETNA/i.test(t.description) &&
          (keepOlder || t.date > since),
      ),
      ...months.map(premium),
    ],
  };
};
const fire = (data: ProfileInput) => health.detect({ profile: buildProfile(data), data });

describe("insurance premiums as a year", () => {
  it("counts twelve months of a premium as a year, not the two years in the data", () => {
    const s = fire(withPremiums(Array.from({ length: 24 }, (_, i) => i)));
    expect(s).not.toBeNull();
    expect(s!.worthCents).toBe(Math.round(120_000 * R.healthCompareShare));
  });

  it("puts a premium charged every month of a short history on a year", () => {
    const data = withPremiums([0, 1, 2], false);
    const profile = buildProfile(data);
    expect(profile.months).toBeLessThan(12);
    const s = health.detect({ profile, data });
    expect(s).not.toBeNull();
    // By hand: $100 a month is $1,200 a year; three months' $300 is not.
    expect(s!.worthCents).toBe(Math.round(120_000 * R.healthCompareShare));
    expect(s!.short).toContain("$300.00");
  });

  it("makes no yearly figure from one premium in a short history", () => {
    expect(fire(withPremiums([0], false))).toBeNull();
  });
});
