import { describe, expect, it } from "vitest";
import { guessFilingStatus, payingTogether } from "./tax-profile";

// CodeRabbit sweep 1b: one employer's two bank labels counted as two employers (so a single
// person read as a couple), and so did two one-off deposits on one date.
const row = (description: string, date: string) => ({ description, date });

describe("employers behind paychecks", () => {
  it("one employer under two bank labels is one employer", () => {
    const rows = [
      row("ACME PAYROLL PPD", "2026-03-15"),
      row("ACME PAYROLL PPD", "2026-04-15"),
      row("ACME DIRECT DEP", "2026-03-31"),
      row("ACME DIRECT DEP", "2026-04-30"),
    ];
    expect(guessFilingStatus({ jointAccounts: 0, payrollNames: payingTogether(rows) })).toBeNull();
  });
  it("two employers that each repeat still read as two", () => {
    const rows = [
      row("ACME PAYROLL", "2026-03-15"),
      row("ACME PAYROLL", "2026-04-15"),
      row("GLOBEX DIRECT DEP", "2026-03-20"),
      row("GLOBEX DIRECT DEP", "2026-04-20"),
    ];
    expect(
      guessFilingStatus({ jointAccounts: 0, payrollNames: payingTogether(rows) })?.status,
    ).toBe("married_joint");
  });
  it("two one-off deposits on one date are not two jobs", () => {
    const rows = [row("ACME PAYROLL", "2026-03-15"), row("GLOBEX PAYROLL", "2026-03-15")];
    expect(guessFilingStatus({ jointAccounts: 0, payrollNames: payingTogether(rows) })).toBeNull();
  });
});
