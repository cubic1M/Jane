import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { COVER_FACT_DETECTORS, isCarLine } from "./cover-facts";
import { runDetectors } from "./index";
import { grad } from "./__fixtures__/students";

// CodeRabbit sweep 1c: a carrier's name alone (State Farm, Allstate) sells homes too, so a line that
// names a home policy and no car is not car cover, and "AUTO PAY" is how a bill is paid, not a car.
const row = (date: string, description: string): ProfileTx => ({
  date,
  amountCents: 100_000,
  description,
  pfc: "GENERAL_SERVICES_INSURANCE",
  accountId: "grad-checking",
});
const fire = (description: string) => {
  const data: ProfileInput = {
    ...grad(),
    transactions: [
      ...grad().transactions,
      row("2026-05-05", description),
      row("2026-11-05", description),
    ],
  };
  return (
    runDetectors({ profile: buildProfile(data), data }, COVER_FACT_DETECTORS).find(
      (s) => s.topic === "car_cover_cost",
    ) ?? null
  );
};

describe("car cover's line", () => {
  it("does not call two homeowners premiums from a car insurer car cover", () => {
    expect(fire("STATE FARM HOMEOWNERS")).toBeNull();
    expect(fire("ALLSTATE HOME")).toBeNull();
    expect(fire("STATE FARM AUTO")).not.toBeNull();
  });
  it("does not take AUTO PAY for a car", () => {
    expect(isCarLine("STATE FARM HOMEOWNERS AUTO PAY")).toBe(false);
    expect(isCarLine("STATE FARM HOMEOWNERS AUTOPAY")).toBe(false);
    expect(isCarLine("STATE FARM AUTO INSURANCE")).toBe(true);
    expect(isCarLine("STATE FARM HOMEOWNERS AUTO")).toBe(true);
  });
});
