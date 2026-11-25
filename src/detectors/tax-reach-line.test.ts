import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { Detector } from "./contract";
import { taxReach, taxReachLine } from "./tax-reach";

// CodeRabbit sweep 1c, PR 2266 (comment 4695930951): the admin tax scoreboard shows a tool whose
// covering detector threw as not evaluated, apart from one that ran and found no one.

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

describe("the tax scoreboard line", () => {
  const reach = taxReach(["tool_a", "tool_b"], [boom, quiet]);
  const line = (tool: string) => taxReachLine(reach.find((r) => r.tool === tool)!);

  it("says a detector that threw was not evaluated", () => {
    expect(line("tool_a")).toMatch(/^tool_a: not evaluated: 96 checks by boom failed to run$/);
    expect(line("tool_a")).not.toContain("reaches no one");
  });

  it("still says a detector that ran and found no one reaches no one", () => {
    expect(line("tool_b")).toBe("tool_b: reaches no one");
  });

  it("keeps the exempt reason and notes the failure beside it", () => {
    const text = taxReachLine({
      tool: "t",
      detectors: ["boom"],
      reached: [],
      exempt: "never suggests by itself",
      needsPerson: null,
      unevaluated: [{ detector: "boom", person: "maya", date: "2026-01-17" }] as never,
    });
    expect(text).toBe("t: never suggests by itself; 1 check by boom failed to run");
  });

  it("flags a possible undercount for a tool that reached someone", () => {
    const text = taxReachLine({
      tool: "t",
      detectors: ["a", "boom"],
      reached: [{ person: "maya", months: ["Jan", "Feb"] }] as never,
      exempt: null,
      needsPerson: null,
      unevaluated: [{ detector: "boom", person: "maya", date: "2026-01-17" }] as never,
    });
    expect(text).toBe(
      "t: maya (Jan, Feb), by a, boom; 1 check by boom failed to run, so this may undercount",
    );
  });
});
