import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PERSON_IDS } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { TRADEOFF_DETECTORS } from "./tradeoffs";

// Spec step 241: goals that can't all be on time, brought to the person unasked.
const [goalTradeoffs] = TRADEOFF_DETECTORS;
const run = (data: ProfileInput) => goalTradeoffs.detect({ profile: buildProfile(data), data });
const withRoom = (data: ProfileInput, goalRoomCents: number): ProfileInput => ({
  ...data,
  extras: { householdMembers: 0, ...data.extras, goalRoomCents },
});

describe("goals that trade off (step 241)", () => {
  it("tells the Reyes their trip and kitchen can't both be on time, and which to put first", () => {
    const s = run(inputFor("family"));
    expect(s?.topic).toBe("goal_tradeoffs");
    expect(s?.why).toMatch(/^Family trip and Kitchen redo need \$[\d,]+\.\d\d a month together/);
    expect(s?.why).toMatch(/Putting Family trip first/);
    expect(s?.worthKind).toBe("risk");
    expect(s?.worthCents).toBeGreaterThan(0);
    expect(s?.confidence.percent).toBeGreaterThanOrEqual(50);
    expect(s?.action.href).toBe("/goals#tradeoffs");
  });

  it("uses the year plan's room when it's kept, and is quiet when there's enough", () => {
    expect(run(withRoom(inputFor("family"), 1_000_000))).toBeNull();
    expect(run(withRoom(inputFor("family"), 100_000))?.short).toMatch(/room for \$1,000\.00/);
  });

  it("needs two goals or more", () => {
    for (const id of PERSON_IDS.filter((p) => p !== "family")) {
      expect(run(inputFor(id)), id).toBeNull();
    }
    const data = inputFor("family");
    const one = { ...data, extras: { ...data.extras!, goals: data.extras!.goals!.slice(0, 1) } };
    expect(run(one)).toBeNull();
  });
});
