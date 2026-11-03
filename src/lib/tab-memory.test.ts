import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetThisTab, stopPushHere } from "./tab-memory";

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

describe("stopPushHere", () => {
  afterEach(() => vi.unstubAllGlobals());

  const browserWith = (getRegistration: () => Promise<unknown>) =>
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

  it("ends this browser's notifications", async () => {
    const unsubscribe = vi.fn(async () => true);
    browserWith(async () => ({
      pushManager: { getSubscription: async () => ({ unsubscribe }) },
    }));
    await stopPushHere();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("doesn't mind no service worker, no subscription or a refusal", async () => {
    vi.stubGlobal("navigator", {});
    await expect(stopPushHere()).resolves.toBeUndefined();
    browserWith(async () => undefined);
    await expect(stopPushHere()).resolves.toBeUndefined();
    browserWith(async () => ({ pushManager: { getSubscription: async () => null } }));
    await expect(stopPushHere()).resolves.toBeUndefined();
    browserWith(async () => {
      throw new Error("blocked");
    });
    await expect(stopPushHere()).resolves.toBeUndefined();
  });
});
