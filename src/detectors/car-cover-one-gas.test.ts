import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { INSURANCE_DETECTORS } from "./insurance";
import { runDetectors } from "./index";

// Chat tests, 11-16 (gate D): a student with one month of checking and a single Shell charge got
// "Check your car is insured", a $100,000 risk marked urgent and required, at 19% sure. One
// gas-station charge can be a snack, or a borrowed or rented car. A car is asked about from a few
// car signs in the year, or when the person told Jane they have one.

const gas = (dates: string[]) =>
  dates.map((date) => ({
    date,
    amountCents: 4_210,
    description: "SHELL OIL 57444 BERKELEY CA",
    pfc: "TRANSPORTATION_GAS",
    accountId: "chk",
  }));

// The sample renter, without any car signs of their own.
const person = (extra: ProfileInput["transactions"], over: Partial<ProfileInput> = {}) => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    transactions: [
      ...base.transactions.filter(
        (t) =>
          !t.pfc?.startsWith("TRANSPORTATION") &&
          !t.pfc?.startsWith("LOAN_PAYMENTS_CAR") &&
          !/\b(?:shell|chevron|geico|progressive|parking|toll|auto)\b/i.test(t.description),
      ),
      ...extra,
    ],
    ...over,
  };
  return runDetectors({ profile: buildProfile(data), data }, INSURANCE_DETECTORS).some(
    (s) => s.topic === "auto_insurance",
  );
};

describe("asking whether a car is insured", () => {
  it("isn't done from one gas-station charge", () => {
    expect(person(gas(["2026-10-12"]))).toBe(false);
  });

  it("is done from a few car signs in the year", () => {
    expect(person(gas(["2026-08-12", "2026-09-14", "2026-10-12"]))).toBe(true);
  });

  it("is done when they told Jane they have a car", () => {
    expect(person(gas(["2026-10-12"]), { told: { has_car: true } })).toBe(true);
  });
});
