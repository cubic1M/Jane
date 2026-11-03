import { describe, expect, it } from "vitest";
import { canImportCsv, canImportHoldings } from "./csv-access";

describe("canImportCsv", () => {
  it("lets every signed-in person with a real account upload statements", () => {
    expect(canImportCsv({ id: "cm1abc" })).toBe(true);
    expect(canImportCsv({ id: "cm1admin", role: "admin" } as never)).toBe(true);
  });

  it("keeps trial people (sample data) out", () => {
    expect(canImportCsv({ id: "trial_abc123" })).toBe(false);
  });

  it("lets someone trying Jane with their own statement upload statements, not holdings", () => {
    expect(canImportCsv({ id: "trial_own_abc123" })).toBe(true);
    expect(canImportHoldings({ id: "trial_own_abc123" })).toBe(false);
    expect(canImportHoldings({ id: "trial_abc123" })).toBe(false);
    expect(canImportHoldings({ id: "cm1abc" })).toBe(true);
  });
});
