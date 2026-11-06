import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS } from "@/config/rate-limits";
import { pageShown, resetPageCacheForTests, startPageCache } from "./page-cache";

// Debugger 11-06: someone trying Jane with their own statement was refused their own taps after
// about four pages, because each page's preloads counted toward their 120 pages a minute.
function browser() {
  const prefetch = vi.fn();
  vi.stubGlobal("window", {
    self: 1,
    top: 1,
    location: { pathname: "/home", search: "", href: "https://jane.test/home", reload: vi.fn() },
    addEventListener: () => {},
  });
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: () => {},
    querySelector: () => null,
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  startPageCache({ refresh: vi.fn(), prefetch });
  return prefetch;
}

describe("preloading pages", () => {
  afterEach(() => {
    resetPageCacheForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("preloads the other pages for a signed-in person", async () => {
    vi.useFakeTimers();
    const prefetch = browser();
    pageShown("person1", Date.now());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prefetch).toHaveBeenCalled();
  });

  it("preloads nothing for someone trying Jane, so four pages stay well inside their minute", async () => {
    vi.useFakeTimers();
    const prefetch = browser();
    for (let view = 0; view < 4; view += 1) {
      pageShown("trial_own_abc", Date.now());
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(prefetch).not.toHaveBeenCalled();
    // What the proxy counts for them: each page they open, and each page preloaded for them.
    expect(4 + prefetch.mock.calls.length).toBeLessThan(RATE_LIMITS.trialPages.limit);
  });
});
