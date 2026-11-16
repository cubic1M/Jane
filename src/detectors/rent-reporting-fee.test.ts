import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { RENTING_DETECTORS } from "./renting";

// Debug 2 (11-16, a student's 14 months of statements, 1280 light): "Get your rent reported, save
// $9/yr", though its why said reporting costs about $6.95 a month ($83.40 a year). What reporting
// saves is counted after its fee, and it isn't offered when it doesn't pay.

const reporting = (owedCents: number | null) => {
  const base = inputFor("renter");
  const data: ProfileInput =
    owedCents === null
      ? base
      : {
          ...base,
          // Only her card owes: the rest of what she owes is set aside.
          accounts: base.accounts.map((a) =>
            a.type === "credit"
              ? { ...a, balanceCents: owedCents }
              : a.type === "loan"
                ? { ...a, balanceCents: 0 }
                : a,
          ),
        };
  return (
    runDetectors({ profile: buildProfile(data), data }, RENTING_DETECTORS).find(
      (s) => s.topic === "rent_reporting",
    ) ?? null
  );
};

describe("rent reporting against its own fee", () => {
  it("isn't offered when the better rate is worth less than the fee", () => {
    // $1,800 owed: 0.5% is $9 a year.
    expect(reporting(180_000)).toBeNull();
    // Maya as she is, about $80.70 a year: still less than $83.40.
    expect(reporting(null)).toBeNull();
  });

  it("says what's left after the fee", () => {
    // $30,000 owed: $150 a year, $66.60 after the fee.
    const s = reporting(3_000_000);
    expect(s?.worthCents).toBe(6_660);
    expect(s?.why).toContain(
      "a slightly better rate is worth about $150.00 a year, $66.60 after its fee of about $6.95 a month.",
    );
  });
});
