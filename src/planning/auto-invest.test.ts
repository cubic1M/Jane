import { describe, expect, it } from "vitest";
import {
  LEFTOVER_SHARE,
  MAX_CONTRIBUTION_CENTS,
  MIN_CONTRIBUTION_CENTS,
  SAFE_TO_SPEND_FLOOR_CENTS,
} from "@/config/auto-invest";
import { CORE_FUNDS } from "@/config/funds";
import { TARGET_MIXES, type RiskLevel } from "@/config/investing";
import { contributionBuys, decideContribution, suggestedAmount } from "./auto-invest";

// Spec step 134: never invests money safe to spend needs.

const FLOOR = SAFE_TO_SPEND_FLOOR_CENTS;

describe("decideContribution", () => {
  it("invests the set amount when safe to spend has room", () => {
    expect(
      decideContribution({ mode: "fixed", amountCents: 20_000, safeCents: FLOOR + 50_000 }),
    ).toEqual({
      status: "invested",
      amountCents: 20_000,
    });
  });

  it("never takes safe to spend below the floor: invests only the room", () => {
    expect(
      decideContribution({ mode: "fixed", amountCents: 20_000, safeCents: FLOOR + 5_000 }),
    ).toEqual({
      status: "invested",
      amountCents: 5_000,
    });
    for (const safe of [0, FLOOR - 1, FLOOR, FLOOR + 10_000, FLOOR + 1_000_000]) {
      for (const mode of ["fixed", "leftover"] as const) {
        const d = decideContribution({ mode, amountCents: 50_000, safeCents: safe });
        if (d.status === "invested") expect(d.amountCents).toBeLessThanOrEqual(safe - FLOOR);
      }
    }
  });

  it("pauses the payday, saying why, when safe to spend is low or unknown", () => {
    expect(
      decideContribution({
        mode: "fixed",
        amountCents: 20_000,
        safeCents: FLOOR + MIN_CONTRIBUTION_CENTS - 1,
      }),
    ).toEqual({
      status: "paused",
      reason: "Safe to spend is $1,025, and I keep at least $1,000 of it for you.",
    });
    expect(
      decideContribution({ mode: "leftover", amountCents: null, safeCents: 30_000 }).status,
    ).toBe("paused");
    expect(
      decideContribution({ mode: "fixed", amountCents: 20_000, safeCents: null }),
    ).toMatchObject({
      status: "paused",
      reason: expect.stringMatching(/can't see your checking account/),
    });
  });

  it("invests part of the rest after bills and goals, up to the cap", () => {
    expect(
      decideContribution({ mode: "leftover", amountCents: null, safeCents: FLOOR + 100_000 }),
    ).toEqual({
      status: "invested",
      amountCents: 100_000 * LEFTOVER_SHARE,
    });
    expect(
      decideContribution({ mode: "leftover", amountCents: null, safeCents: FLOOR + 10_000_000 }),
    ).toEqual({
      status: "invested",
      amountCents: MAX_CONTRIBUTION_CENTS,
    });
  });
});

describe("suggestedAmount and contributionBuys", () => {
  it("suggests a round share of the paycheck", () => {
    expect(suggestedAmount(245_000)).toBe(10_000);
    expect(suggestedAmount(400_000)).toBe(20_000);
    expect(suggestedAmount(10_000)).toBe(2_500);
  });

  it("splits a contribution into the core funds in the profile's mix, to the cent", () => {
    for (const level of [1, 2, 3, 4, 5] as RiskLevel[]) {
      const buys = contributionBuys(10_001, level);
      expect(buys.reduce((s, b) => s + b.amountCents, 0)).toBe(10_001);
      expect(buys.map((b) => b.ticker)).toEqual([
        CORE_FUNDS.us_stocks,
        CORE_FUNDS.intl_stocks,
        CORE_FUNDS.bonds,
      ]);
      const t = TARGET_MIXES[level];
      expect(buys[0].amountCents).toBe(Math.round((10_001 * t.us_stocks) / (1 - t.cash)));
    }
  });
});
