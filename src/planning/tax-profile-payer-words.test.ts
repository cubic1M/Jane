import { describe, expect, it } from "vitest";
import { incomeLine } from "./tax-profile";

// Debug 2, third desktop sweep (11-16, upload S5: one month of Wells Fargo checking): the tax
// card asked "your income for 2026 looks like wages from Campus Dining Payroll Ppd (W-2)", the
// bank's line, while the forms list said "W-2 from Campus Dining". The income line names the
// payer as the forms do.

describe("where income was seen, as the tax profile says it", () => {
  it("names the payer without the bank's words", () => {
    expect(
      incomeLine({ kind: "w2", from: ["Campus Dining Payroll Ppd"], totalCents: 214_340 }),
    ).toBe("wages from Campus Dining (W-2)");
    expect(
      incomeLine({
        kind: "w2",
        from: ["UC DAVIS PAYROLL PPD ID: 9460001234", "Sweetgreen"],
        totalCents: 300_000,
      }),
    ).toBe("wages from UC DAVIS and Sweetgreen (W-2)");
  });
});
