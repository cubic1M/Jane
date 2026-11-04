import { describe, expect, it } from "vitest";
import type { Snapshot } from "../snapshot";
import { safeLine } from "./brief";

// Debugger 11-04: "You have $0.00 safe to spend this month", to a freelancer with money in the bank.
describe("safeLine", () => {
  const line = (safeToSpend: Snapshot["safeToSpend"]) =>
    safeLine({ safeToSpend } as Snapshot, "2026-11-03");

  it("says what tax took", () => {
    expect(line({ safeCents: 0, payday: null, taxHeldCents: 47_267 })).toBe(
      "You have $0.00 safe to spend this month, after setting aside $472.67 for tax.",
    );
  });

  it("says nothing of tax without any held", () => {
    expect(line({ safeCents: 120_000, payday: null })).toBe(
      "You have $1,200.00 safe to spend this month.",
    );
  });
});
