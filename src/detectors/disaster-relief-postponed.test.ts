import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { SAMPLE_RELIEF } from "@/config/disasters";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (det-05, 2): a payment moved from April 15 to a later deadline stays on the
// card after April 15 has passed, until the new date; the new date then sets the urgency.
const card = (today: string, postponedTo: string) => {
  const base = inputFor("family");
  const data: ProfileInput = {
    ...base,
    today,
    state: "TX",
    extras: {
      ...base.extras!,
      disasterRelief: [{ ...SAMPLE_RELIEF[0], incidentFrom: "2027-01-10", postponedTo }],
    },
  };
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "disaster_relief",
  );
};

describe("a postponed obligation after its old date", () => {
  it("still counts the moved April payment on May 1 when the deadline is October 15", () => {
    const s = card("2027-05-01", "2027-10-15");
    expect(s).toBeDefined();
    expect(s?.short).not.toMatch(/^0 /);
    expect(s?.short).toMatch(/federal tax dates? move to/);
    expect(s?.why).toContain("Apr 15, 2027");
  });
  it("is urgent when the new deadline is near, even though the old date has passed", () => {
    expect(card("2027-10-01", "2027-10-15")?.urgency).toBe("now");
    expect(card("2027-04-20", "2027-10-15")?.urgency).toBe("soon");
  });
});
