import { describe, expect, it } from "vitest";
import { looksLikePersonPayee, redactPersonPayees, redactRequestBody } from "./person-payees";

// Two more forms a person's name takes in bank text, found by the debugger after #1513: PayPal's
// "*" when a person follows it, and Bank of America's last name first. Neither may reach Claude.

const PERSON = "[a person]";

describe("names in PayPal and Bank of America lines", () => {
  it.each([
    ["PAYPAL *JANE DOE", `PAYPAL *${PERSON}`],
    ["PAYPAL *JANE DOE 402-935-7733 CA", `PAYPAL *${PERSON} 402-935-7733 CA`],
    ["PayPal *Daniel Smith", `PayPal *${PERSON}`],
    [
      "BKOFAMERICA ACH DES:PAYROLL ID:XXXXX4521 INDN:LEE,JORDAN CO ID:XXXXX12345 PPD",
      `BKOFAMERICA ACH DES:PAYROLL ID:XXXXX4521 INDN:${PERSON} CO ID:XXXXX12345 PPD`,
    ],
    ["DES:TRANSFER INDN:LEE,JORDAN", `DES:TRANSFER INDN:${PERSON}`],
    [
      "Online Banking transfer to LEE,JORDAN Confirmation# 1234",
      `Online Banking transfer to ${PERSON} Confirmation# 1234`,
    ],
    ["Online Banking payment from SMITH,DANIEL R", `Online Banking payment from ${PERSON}`],
    ["Zelle payment to LEE,JORDAN Conf# abc123", `Zelle payment to ${PERSON} Conf# abc123`],
  ])("%s", (text, redacted) => {
    expect(redactPersonPayees(text)).toBe(redacted);
  });

  it("leaves merchants paid through PayPal, own-account transfers and prose alone", () => {
    for (const text of [
      "PAYPAL *NETFLIX",
      "PAYPAL *SPOTIFY USA",
      "PAYPAL *UBER EATS",
      "PAYPAL *JOHNSON CONTROLS",
      "Online Banking transfer to CHK 1234 Confirmation# 5678",
      "Online Banking transfer to SAV 9876",
      "Make a payment to Chase, then check the balance.",
      "Your transfer from Savings, Checking and Brokerage",
    ]) {
      expect(redactPersonPayees(text)).toBe(text);
    }
  });

  it("keeps them out of request bodies and away from the categorizer", () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "PAYPAL *JANE DOE $40" }] });
    expect(redactRequestBody(body)).not.toContain("JANE DOE");
    expect(looksLikePersonPayee("PAYPAL *JANE DOE")).toBe(true);
    expect(looksLikePersonPayee("Online Banking transfer to LEE,JORDAN")).toBe(true);
    expect(looksLikePersonPayee("PAYPAL *NETFLIX")).toBe(false);
  });
});
