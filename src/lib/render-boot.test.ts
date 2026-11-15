import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderLine, resetRenderTimingForTests, type RenderTiming } from "./render-timing";

// A cold render says how long after the instance started it began (speed round, 11-15): the cold
// first visit's start-up and code loading, which the render's own `ms` doesn't include.
const at = (startedAt: number): RenderTiming => ({
  startedAt,
  roundTrips: 0,
  sqlCount: 0,
  dbMs: 0,
  inFlight: 0,
  busySince: 0,
  connects: 0,
  connectMs: 0,
});

describe("a cold render's start", () => {
  beforeEach(() => resetRenderTimingForTests());
  afterEach(() => resetRenderTimingForTests());

  it("is the time from the instance's start to the render's, only when cold", () => {
    expect(renderLine(at(812.4), "/taxes", "document", 1100)).toMatchObject({
      cold: true,
      bootMs: 812,
      ms: 288,
    });
    expect(renderLine(at(5000), "/taxes", "document", 5100)).toMatchObject({
      cold: false,
      bootMs: null,
    });
  });
});
