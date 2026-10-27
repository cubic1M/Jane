import { describe, expect, it } from "vitest";
import { canImportCsv } from "./csv-access";

describe("canImportCsv", () => {
  it("lets every signed-in person with a real account upload statements", () => {
    expect(canImportCsv({ id: "cm1abc" })).toBe(true);
    expect(canImportCsv({ id: "cm1admin", role: "admin" } as never)).toBe(true);
  });

  it("keeps trial people (sample data) out", () => {
    expect(canImportCsv({ id: "trial_abc123" })).toBe(false);
  });
});
