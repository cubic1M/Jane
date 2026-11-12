import { describe, expect, it } from "vitest";
import { foundLine } from "./jane-found";

// Home's "Jane found" line (home redesign 11-12): never "$0/yr", and not
// "Nothing yet" before the first scan has looked (beta walk 11-12, from the debugger).
describe("foundLine", () => {
  // No count: "23" beside the cards' "1 of 13" read as a mistake (the plan vs today's cards).
  it("asks for a yes or not now once there's something", () => {
    expect(foundLine(1, false)).toBe("Yes or not now, one at a time.");
    expect(foundLine(23, true)).toBe("Yes or not now, one at a time.");
  });

  it("says Jane is still looking before the first scan, and keeps watching after", () => {
    expect(foundLine(0, true)).toBe("Still looking through your accounts.");
    expect(foundLine(0, false)).toBe("Nothing yet. Jane keeps watching.");
  });
});
