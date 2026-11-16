import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Debug 3 (11-16): a card marked gone when it was answered stayed gone in the tab even when the
// answer never reached the server. unmarkGone gives it back: in this page, in the tab's storage
// (a reload, the chat's frame) and in what a load asks the server to skip.

let store: Map<string, string>;
let told: string[];

beforeEach(() => {
  vi.resetModules();
  store = new Map();
  told = [];
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    dispatchEvent: (e: CustomEvent) => told.push(String(e.detail)),
  });
  vi.stubGlobal(
    "CustomEvent",
    class {
      constructor(
        public type: string,
        public init?: { detail?: unknown },
      ) {}
      get detail() {
        return this.init?.detail;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("an answer that didn't go through", () => {
  it("puts its card back in the page, the tab's storage and the skip list", async () => {
    const { goneIds, markGone, skipParam, unmarkGone } = await import("./dock-gone");
    markGone("a");
    markGone("b");
    expect(goneIds()).toEqual(["a", "b"]);
    unmarkGone("a");
    expect(goneIds()).toEqual(["b"]);
    expect(JSON.parse(store.get("jane:dock-gone")!)).toEqual(["b"]);
    expect(skipParam(goneIds())).toBe("b");
    // Every stack is told, as it is when one goes.
    expect(told).toEqual(["a", "b", "a"]);
  });

  it("comes back when only the tab's storage had it (marked in the chat's frame)", async () => {
    store.set("jane:dock-gone", JSON.stringify(["x", "y"]));
    const { goneIds, unmarkGone } = await import("./dock-gone");
    unmarkGone("x");
    expect(goneIds()).toEqual(["y"]);
    unmarkGone("nope");
    expect(told).toEqual(["x"]);
  });
});
