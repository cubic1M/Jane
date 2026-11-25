import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { COVER_FACT_DETECTORS, isCarLine } from "./cover-facts";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (#2270): "AUTO PAY" is how a bill is paid, not what it pays for; and a
// merchant name on one charge and not another must not split one policy's charges into two.
const rows = (description: string, merchants: (string | undefined)[]) =>
  ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((date, i) => ({
    date,
    amountCents: 30_000,
    description,
    ...(merchants[i] ? { merchantName: merchants[i] } : {}),
    pfc: "GENERAL_SERVICES_INSURANCE",
    accountId: "checking",
  }));
const run = (transactions: ProfileInput["transactions"]) => {
  const data: ProfileInput = {
    today: "2026-11-25",
    transactions,
    accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 100_000 }],
    liabilities: [],
    told: {},
  };
  return runDetectors({ profile: buildProfile(data), data }, COVER_FACT_DETECTORS).find(
    (s) => s.topic === "car_cover_cost",
  );
};

describe("car cover's line", () => {
  it("does not take AUTO PAY for a car", () => {
    expect(isCarLine("STATE FARM HOMEOWNERS AUTO PAY")).toBe(false);
    expect(isCarLine("STATE FARM HOMEOWNERS AUTOPAY")).toBe(false);
    expect(isCarLine("STATE FARM AUTO INSURANCE")).toBe(true);
    expect(isCarLine("STATE FARM HOMEOWNERS AUTO")).toBe(true);
    expect(run(rows("STATE FARM HOMEOWNERS AUTO PAY", []))).toBeUndefined();
  });
  it("keeps one policy's charges together when only some carry a merchant name", () => {
    const s = run(rows("GEICO *AUTO", ["GEICO", undefined, "GEICO", undefined]));
    expect(s?.short).toContain("$3,600.00 a year");
  });
});
