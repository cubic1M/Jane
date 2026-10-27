import { describe, expect, it } from "vitest";
import { rollOf, sha256Hex } from "./hash";

describe("hashes", () => {
  it("stores a token as its SHA-256 in hex", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("rolls the same 0 to 9 for the same id", () => {
    expect(rollOf("request-1")).toBe(rollOf("request-1"));
    const rolls = Array.from({ length: 200 }, (_, i) => rollOf(`r${i}`));
    expect(Math.min(...rolls)).toBe(0);
    expect(Math.max(...rolls)).toBe(9);
  });
});
