import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE, type PersonId } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HOLDINGS_DETECTORS } from "./holdings";
import { runDetectors } from "./index";

// Spec step 262: the detectors that read holdings reach the people they are written for, and
// never anyone on a must-not list, each with dollars and a percentage with its reason.

const firedFor = (id: PersonId) => {
  const data = inputFor(id);
  return runDetectors({ profile: buildProfile(data), data }, HOLDINGS_DETECTORS);
};
const WHO: Record<string, PersonId[]> = {
  investment_fees: ["equity", "preretire", "retiree"],
  rebalance: ["preretire", "retiree"],
  auto_invest: ["equity"],
  old_accounts: ["preretire"],
  asset_location: ["equity"],
  costly_products: ["retiree"],
};

describe("holdings detectors on the eight people", () => {
  for (const [topic, who] of Object.entries(WHO)) {
    it(`${topic} fires for ${who.join(", ")} and no one on a must-not list`, () => {
      for (const p of PEOPLE) {
        const fired = firedFor(p.id).some((s) => s.topic === topic);
        if (who.includes(p.id)) expect(fired, `${p.id} should get ${topic}`).toBe(true);
        if ((p.mustNot as readonly string[]).includes(topic)) {
          expect(fired, `${p.id} must not get ${topic}`).toBe(false);
        }
      }
    });
  }

  it("does nothing without holdings", () => {
    const data = { ...inputFor("equity"), holdings: undefined };
    const topics = runDetectors({ profile: buildProfile(data), data }, HOLDINGS_DETECTORS).map(
      (s) => s.topic,
    );
    for (const t of ["investment_fees", "rebalance", "asset_location"]) {
      expect(topics).not.toContain(t);
    }
  });

  it("gives every suggestion dollars, a percentage with its reason and a button", () => {
    for (const p of PEOPLE) {
      for (const s of firedFor(p.id)) {
        expect(s.worthCents).toBeGreaterThan(0);
        expect(s.confidence.percent).toBeGreaterThan(0);
        expect(s.confidence.reason).not.toBe("");
        expect(s.action.href).toMatch(/^\//);
        expect(s.why).toMatch(/\$/);
      }
    }
  });
});
