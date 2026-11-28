import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  later: [] as (() => Promise<void>)[],
  outsideRequest: false,
}));
vi.mock("next/server", () => ({
  after: (run: () => Promise<void>) => {
    if (hoisted.outsideRequest) throw new Error("`after` was called outside a request scope");
    hoisted.later.push(run);
  },
}));
vi.mock("@/lib/suggestions", () => ({ scanSuggestions: vi.fn() }));
vi.mock("@/lib/trial-rescans", () => ({ mayRescan: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn() } }));

import { log } from "@/lib/log";
import { rescanAfterAnswer } from "@/lib/rescan-after-answer";
import { scanSuggestions } from "@/lib/suggestions";
import { mayRescan } from "@/lib/trial-rescans";

const NOW = new Date("2026-11-05T23:00:00Z");
const flush = async () => {
  for (const run of hoisted.later.splice(0)) await run();
};

describe("rescanAfterAnswer", () => {
  beforeEach(() => {
    hoisted.later.length = 0;
    hoisted.outsideRequest = false;
    vi.mocked(scanSuggestions).mockReset().mockResolvedValue({ fired: 0, selected: [] });
    vi.mocked(mayRescan).mockReset().mockResolvedValue(true);
    vi.mocked(log.error).mockReset();
  });

  it("runs the existing suggestion scan for that person after the reply, once", async () => {
    await rescanAfterAnswer("u1", { now: NOW });
    // Nothing has run yet: it waits until the reply has gone out.
    expect(scanSuggestions).not.toHaveBeenCalled();
    await flush();
    expect(scanSuggestions).toHaveBeenCalledTimes(1);
    expect(scanSuggestions).toHaveBeenCalledWith("u1", expect.objectContaining({ now: NOW }));
  });

  it("holds back a try-out person past their limit", async () => {
    vi.mocked(mayRescan).mockResolvedValue(false);
    await rescanAfterAnswer("trial_1");
    await flush();
    expect(scanSuggestions).not.toHaveBeenCalled();
  });

  it("never undoes the answer when the scan fails", async () => {
    vi.mocked(scanSuggestions).mockRejectedValue(new Error("down"));
    await rescanAfterAnswer("u1");
    await flush();
    expect(log.error).toHaveBeenCalled();
  });

  it("a failed limit check never blocks the answer", async () => {
    vi.mocked(mayRescan).mockRejectedValue(new Error("down"));
    await expect(rescanAfterAnswer("trial_1")).resolves.toBeUndefined();
    await flush();
    expect(scanSuggestions).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it("outside a request there is nothing to run after, and nothing throws", async () => {
    hoisted.outsideRequest = true;
    await expect(rescanAfterAnswer("u1")).resolves.toBeUndefined();
    expect(scanSuggestions).not.toHaveBeenCalled();
    // And no try-out allowance was spent on a scan that could not run.
    expect(mayRescan).not.toHaveBeenCalled();
  });

  it("scans of one person run one after the other, and without learning from the data again", async () => {
    const order: string[] = [];
    vi.mocked(scanSuggestions).mockImplementation(async () => {
      order.push("start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("end");
      return { fired: 0, selected: [] };
    });
    await rescanAfterAnswer("u1");
    await rescanAfterAnswer("u1");
    await Promise.all(hoisted.later.splice(0).map((run) => run()));
    expect(order).toEqual(["start", "end", "start", "end"]);
    expect(scanSuggestions).toHaveBeenCalledWith("u1", expect.objectContaining({ learn: false }));
  });
});
