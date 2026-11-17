import { describe, expect, it } from "vitest";
import { formPayer } from "./tax-documents";

// Debug 2, third desktop sweep (11-16, upload S3: Chase checking paying Nelnet and Toyota
// Financial): Taxes' Forms to expect read "1098-E from Nelnet Student Ln Payment", the line the
// payments came on. A lender is named without the payment's words, as a payroll is.

describe("a lender seen only in payments, as a page names it", () => {
  it("leaves out the payment's words", () => {
    expect(formPayer("Nelnet Student Ln Payment")).toBe("Nelnet");
    expect(formPayer("NELNET STUDENT LN PAYMENT PPD ID: 9102500001")).toBe("NELNET");
    expect(formPayer("Mohela Student Loan Pmt")).toBe("Mohela");
    expect(formPayer("Toyota Financial Pmt")).toBe("Toyota Financial");
  });

  it("keeps a name that is only those words", () => {
    expect(formPayer("Payments")).toBe("Payments");
  });
});
