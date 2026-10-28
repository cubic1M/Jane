import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTORS } from "@/detectors";
import { INVESTING_TRUTH } from "./truth";
import { formatScores, scoreInvesting } from "./score";

// The investing accuracy bench's gate (docs/detectors/investing.md), run with the unit tests: no
// investing detector may fire for someone it shouldn't (precision stays 100%), or miss someone it
// should (recall stays 100%), on the eight sample people. A detector without truth fails here.

describe("the investing accuracy bench", () => {
  it("has truth for every investing detector, and for no detector that doesn't exist", () => {
    const topics = new Set(
      DETECTORS.filter((d) => d.capability === "investing" && !d.topic.startsWith("practice_")).map(
        (d) => d.topic,
      ),
    );
    expect([...topics].filter((t) => !INVESTING_TRUTH[t])).toEqual([]);
    expect(Object.keys(INVESTING_TRUTH).filter((t) => !topics.has(t as never))).toEqual([]);
  });

  it("never fires for someone it shouldn't, and never misses someone it should", () => {
    const scores = scoreInvesting();
    const bad = scores.filter((s) => s.fp > 0 || s.fn > 0);
    expect(bad, `\n${formatScores(scores)}`).toEqual([]);
  });
});
