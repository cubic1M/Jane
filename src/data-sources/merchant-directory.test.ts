import { describe, expect, it } from "vitest";
import { MERCHANT_SEED } from "@/config/merchant-seed";
import { directoryMatch, findInDirectory, normalizeAlias } from "./merchant-directory";

describe("merchant directory matching", () => {
  it.each([
    ["NETFLIX.COM NETFLIX.COM CA", "Netflix"],
    ["NFLX DIGITAL", null],
    ["SPOTIFY USA 877-778-1161", "Spotify"],
    ["APPLE.COM/BILL 866-712-7753 CA", "Apple"],
    ["HBO MAX 855-442-6629", "Max"],
    ["PAYPAL *HULU 402-935-7733 CA", "Hulu"],
    ["APPLE STORE R123", null],
    ["MAXWELL HOUSE CAFE", null],
  ])("%j is %j", (description, name) => {
    expect(directoryMatch(description, MERCHANT_SEED)?.name ?? null).toBe(name);
  });

  it("matches aliases exactly when they're one word", () => {
    expect(findInDirectory("nflx", MERCHANT_SEED)?.name).toBe("Netflix");
    expect(findInDirectory("nflx digital", MERCHANT_SEED)).toBeNull();
  });

  it("stores every seed key and alias already normalized", () => {
    for (const m of MERCHANT_SEED) {
      for (const phrase of [m.key, ...m.aliases])
        expect(normalizeAlias(phrase), phrase).toBe(phrase);
    }
  });
});
