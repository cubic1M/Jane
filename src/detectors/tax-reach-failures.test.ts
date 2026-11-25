import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import type { Detector } from "./contract";
import { taxReach } from "./tax-reach";

// CodeRabbit sweep 1c, det-04 finding 15: a detector that throws is marked unevaluated for that
// person and date, not scored as reaching no one.

const boom = {
  capability: "taxes",
  topic: "boom",
  covers: ["tool_a"],
  needs: [],
  detect: () => {
    throw new Error("broken");
  },
} as unknown as Detector;
const quiet = {
  capability: "taxes",
  topic: "quiet",
  covers: ["tool_b"],
  needs: [],
  detect: () => null,
} as unknown as Detector;

describe("tax reach with a failing detector", () => {
  const reach = taxReach(["tool_a", "tool_b"], [boom, quiet]);

  it("lists every person and month the failing detector was not evaluated for", () => {
    const a = reach.find((r) => r.tool === "tool_a")!;
    expect(a.reached).toEqual([]);
    expect(a.unevaluated).toHaveLength(PEOPLE.length * 12);
    expect(a.unevaluated[0]).toMatchObject({ detector: "boom" });
  });

  it("keeps an ordinary non-match apart: nothing unevaluated", () => {
    const b = reach.find((r) => r.tool === "tool_b")!;
    expect(b.reached).toEqual([]);
    expect(b.unevaluated).toEqual([]);
  });
});
