import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageShown, resetPageCacheForTests, startPageCache } from "./page-cache";

// An attack on the page memory, in a real browser: with the session deleted on the server (as after
// "Sign out other devices", or a deletion on another device), an open tab went on showing real
// figures on every page it held, for up to 5 minutes and with no trip to the server.
function browser() {
  const reload = vi.fn();
  const listeners: Record<string, (() => void)[]> = {};
  const win = {
    self: 1,
    top: 1,
    location: { pathname: "/home", search: "", href: "https://jane.test/home", reload },
    fetch: vi.fn(),
    addEventListener: () => {},
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
    querySelector: () => null,
  });
  vi.stubGlobal("navigator", {});
  startPageCache({ refresh: vi.fn(), prefetch: vi.fn() });
  return { reload, returnToTab: () => listeners.visibilitychange?.forEach((fn) => fn()) };
}

const answers = (response: Response | Error) => {
  const fetched = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
};
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
};
const fresh = () => Date.now();

describe("a page from memory, once the session has ended elsewhere", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    resetPageCacheForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetPageCacheForTests();
  });

  it("goes with a full page load, as soon as it comes up", async () => {
    const b = browser();
    answers(new Response(null, { status: 401 }));
    pageShown("u1", fresh());
    await flush();
    expect(b.reload).toHaveBeenCalled();
  });

  it("goes when the session has become someone else's", async () => {
    const b = browser();
    answers(Response.json({ id: "u2" }));
    pageShown("u1", fresh());
    await flush();
    expect(b.reload).toHaveBeenCalled();
  });

  it("is asked about again when the tab comes back, and not on every tap", async () => {
    const b = browser();
    const fetched = answers(Response.json({ id: "u1" }));
    pageShown("u1", fresh());
    pageShown("u1", fresh());
    await flush();
    expect(fetched).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(11_000);
    fetched.mockClear();
    answers(new Response(null, { status: 401 }));
    b.returnToTab();
    await flush();
    expect(b.reload).toHaveBeenCalled();
  });

  it("stays when the answer says nothing about the session", async () => {
    for (const answer of [
      new Response(null, { status: 500 }),
      new Response(null, { status: 429 }),
      new Error("offline"),
    ]) {
      resetPageCacheForTests();
      const b = browser();
      answers(answer);
      pageShown("u1", fresh());
      await flush();
      expect(b.reload).not.toHaveBeenCalled();
    }
  });
});
