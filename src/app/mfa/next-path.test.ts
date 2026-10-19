import { describe, expect, it } from "vitest";
import { safeNext } from "./next-path";

describe("safeNext", () => {
  it("keeps paths inside the app", () => {
    expect(safeNext("/admin/queue", "admin")).toBe("/admin/queue");
    expect(safeNext("/settings#two-factor", "user")).toBe("/settings#two-factor");
  });

  it("never sends anyone to another site", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "evil", null]) {
      expect(safeNext(bad, "user")).toBe("/chat");
      expect(safeNext(bad, "admin")).toBe("/admin/queue");
    }
  });
});
