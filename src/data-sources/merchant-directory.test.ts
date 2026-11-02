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

// Debugger 11-02: "Disney+" normalised to "disney", which isn't "disney plus", so Jane treated it
// as a company it didn't know: on the card, and for the agent after a yes.
describe("a name written with a plus", () => {
  const directory = [
    { key: "disney plus", aliases: ["disneyplus"] },
    { key: "paramount plus", aliases: ["paramountplus"] },
    { key: "disney", aliases: [] },
  ] as unknown as Parameters<typeof findInDirectory>[1];

  it.each([
    ["Disney+", "disney plus"],
    ["Paramount+", "paramount plus"],
    ["Disney Plus", "disney plus"],
    ["Netflix", "netflix"],
    ["AT&T", "at&t"],
  ])("%s reads as %s", (name, key) => {
    expect(normalizeAlias(name)).toBe(key);
  });

  it("finds the company", () => {
    expect(findInDirectory(normalizeAlias("Disney+")!, directory)?.key).toBe("disney plus");
    expect(findInDirectory(normalizeAlias("Paramount+")!, directory)?.key).toBe("paramount plus");
  });
});
