import { describe, expect, it } from "vitest";
import { barWaitFor } from "./nav-pending";

// Main red 11-13 (e2e/tap.spec.ts 3 of 3, e2e/tap-while-preloading.spec.ts): a preload counts as
// in memory from when it starts (src/lib/page-cache.ts), so a tab tapped while its page was still
// on the way waited 600 ms for the bar, with nothing on screen. Every tap answers within 150 ms.

const TAP_MS = 150;
// What drawing the bar itself may take on a slow phone, after its wait.
const DRAW_MS = 30;

describe("the tapped link's bar", () => {
  it("shows inside a tap's 150 ms even when the page is said to be in memory", () => {
    expect(barWaitFor(true)).toBeLessThanOrEqual(TAP_MS - DRAW_MS);
    expect(barWaitFor(false)).toBeLessThanOrEqual(TAP_MS - DRAW_MS);
  });

  it("waits at least as long for a page in memory, so one that's here doesn't flash it", () => {
    expect(barWaitFor(true)).toBeGreaterThanOrEqual(barWaitFor(false));
  });
});
