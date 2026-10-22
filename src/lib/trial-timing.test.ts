import { afterEach, describe, expect, it, vi } from "vitest";
import { phaseTimer } from "./trial-timing";

// Where the time goes between "Try Jane" and a chat that takes a question: one log line per
// stage, durations only.
describe("phaseTimer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs each phase's milliseconds and the total, once, and nothing else", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const timing = phaseTimer("first_sync");
    vi.advanceTimersByTime(120);
    timing.mark("load");
    vi.advanceTimersByTime(30);
    timing.mark("save");
    timing.done({ added: 316 });
    expect(info).toHaveBeenCalledTimes(1);
    const [label, body] = info.mock.calls[0];
    expect(label).toBe("trial_timing");
    expect(JSON.parse(body as string)).toEqual({
      kind: "first_sync",
      load: 120,
      save: 30,
      added: 316,
      totalMs: 150,
    });
  });
});
