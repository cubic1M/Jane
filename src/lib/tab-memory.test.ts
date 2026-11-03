import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetThisTab } from "./tab-memory";

describe("forgetThisTab", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Local build: 9 KB of decision cards were still in the tab after signing out.
  it("clears what the tab kept", () => {
    const clear = vi.fn();
    vi.stubGlobal("window", { sessionStorage: { clear } });
    forgetThisTab();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("doesn't mind when storage is blocked", () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("blocked");
      },
    });
    expect(() => forgetThisTab()).not.toThrow();
  });
});
