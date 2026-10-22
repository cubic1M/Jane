import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PERSON_IDS } from "@/config/people";
import { PRICE_RISE_LEAD_DAYS } from "@/config/price-rises";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { PRICE_RISE_DETECTORS } from "./price-rises";

// Spec step 243: prices about to go up, a month or more ahead.
const [promoEnding] = PRICE_RISE_DETECTORS;
const run = (data: ProfileInput) => promoEnding.detect({ profile: buildProfile(data), data });

describe("price rises (step 243)", () => {
  it("tells Priya her fibre intro price ends and her storage plan renews, in time to call", () => {
    const s = run(inputFor("equity"));
    expect(s?.topic).toBe("promo_ending");
    expect(s?.short).toMatch(/AT&T Fiber intro ends/);
    expect(s?.short).toMatch(/Icloud\+ Annual Plan renews/);
    expect(s?.urgency).toBe("soon");
    expect(s?.why).toMatch(/What|Calling first usually keeps the price/);
    expect(s?.confidence.percent).toBeLessThanOrEqual(75);
    void PRICE_RISE_LEAD_DAYS;
  });

  it("is quiet for everyone whose bills aren't about to go up", () => {
    for (const id of PERSON_IDS.filter((p) => p !== "equity")) {
      expect(run(inputFor(id)), id).toBeNull();
    }
  });
});
