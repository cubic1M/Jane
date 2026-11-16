import { describe, expect, it } from "vitest";
import { formPayer } from "./tax-documents";

// Debug 2 re-walk (11-16, Plaid sandbox one month, 1280 light): Taxes' Forms to expect read "W-2
// from UC DAVIS PAYROLL PPD ID: 9460001234": the ACH entry code and id stayed after the payer, so
// "payroll" wasn't at the end for formPayer to take off. The same on the default sandbox user's
// unnamed paychecks, "Sweetgreen inc payroll ppd id".

describe("who sends the form, as a page says it", () => {
  it("leaves out an ACH line's entry code and id", () => {
    expect(formPayer("UC DAVIS PAYROLL PPD ID: 9460001234")).toBe("UC DAVIS");
    expect(formPayer("Sweetgreen inc payroll ppd id")).toBe("Sweetgreen inc");
    expect(formPayer("TARGET CORP PAYROLL PPD ID: 1410215170")).toBe("TARGET CORP");
  });

  it("leaves out Bank of America's entry details", () => {
    expect(formPayer("STANFORD UNIV DES:PAYROLL ID:XXXXX12 INDN:LEE SAM CO ID:XXXXX PPD")).toBe(
      "STANFORD UNIV",
    );
  });

  it("keeps a name with none of it", () => {
    expect(formPayer("Sweetgreen")).toBe("Sweetgreen");
    expect(formPayer("Webster Bank")).toBe("Webster Bank");
  });
});
