import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HOLDINGS_DETECTORS } from "./holdings";
import { runDetectors } from "./index";
import { PLANNING_DETECTORS } from "./planning";

// One fund is one card (the manager, 11-19; debug 3's class 7): the fee card (investment_fees)
// and the 401(k) menu card (plan_menu) both named the same costly 401(k) fund for demo, family,
// equity and preretire. The fee card keeps it, the fee the person can check on their own
// statement, and says what the plan's menu adds as a fact with its source.

const cards = (id: (typeof PEOPLE)[number]["id"]) => {
  const data = inputFor(id);
  return runDetectors({ profile: buildProfile(data), data }, [
    ...HOLDINGS_DETECTORS,
    ...PLANNING_DETECTORS,
  ]);
};

describe("a costly 401(k) fund", () => {
  it("is one card for every sample person, never a fee card and a menu card", () => {
    const both = PEOPLE.filter((p) => {
      const topics = cards(p.id).map((s) => s.topic);
      return topics.includes("investment_fees") && topics.includes("plan_menu");
    }).map((p) => p.id);
    expect(both).toEqual([]);
  });

  it("says on the fee card what the plan's menu offers, as a fact with its source", () => {
    const fee = cards("preretire").find((s) => s.topic === "investment_fees")!;
    expect(fee.why).toMatch(/Your 401\(k\)'s menu also has .+ a year\), a fund of the same kind/);
    expect(fee.why).toContain("(your plan's fund list)");
    expect(fee.why).not.toMatch(/\bswitch|\byou should\b|\bmove\b/i);
  });
});
