import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./connect";

// The connect flow's way back is a path on Jane only.

describe("safeReturnPath", () => {
  it("keeps a same-site path with its query", () => {
    expect(safeReturnPath("/insurance")).toBe("/insurance");
    expect(safeReturnPath("/investments?tab=holdings")).toBe("/investments?tab=holdings");
  });

  it("sends anything else home", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "insurance",
      "",
      null,
      `/${"x".repeat(300)}`,
    ]) {
      expect(safeReturnPath(bad)).toBe("/home");
    }
  });
});
