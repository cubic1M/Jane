import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetOnThisBrowser } from "./tab-memory";

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("forgetOnThisBrowser", () => {
  afterEach(() => vi.unstubAllGlobals());

  const browserWith = (getRegistration: () => Promise<unknown>) =>
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

  // Local build: 9 KB of decision cards were still in the tab after signing out.
  it("clears what the tab kept", () => {
    const clear = vi.fn();
    vi.stubGlobal("window", { sessionStorage: { clear } });
    vi.stubGlobal("navigator", {});
    forgetOnThisBrowser();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("doesn't mind when storage is blocked", () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("navigator", {});
    expect(() => forgetOnThisBrowser()).not.toThrow();
  });

  it("ends this browser's notifications", async () => {
    vi.stubGlobal("window", { sessionStorage: { clear: vi.fn() } });
    const unsubscribe = vi.fn(async () => true);
    browserWith(async () => ({
      pushManager: { getSubscription: async () => ({ unsubscribe }) },
    }));
    forgetOnThisBrowser();
    await settle();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("doesn't mind no service worker, no subscription or a refusal", async () => {
    vi.stubGlobal("window", { sessionStorage: { clear: vi.fn() } });
    for (const getRegistration of [
      async () => undefined,
      async () => ({ pushManager: { getSubscription: async () => null } }),
      async () => {
        throw new Error("blocked");
      },
    ]) {
      browserWith(getRegistration);
      expect(() => forgetOnThisBrowser()).not.toThrow();
      await settle();
    }
  });
});
