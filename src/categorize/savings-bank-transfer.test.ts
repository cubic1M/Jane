import { describe, expect, it } from "vitest";
import { categorizeByRules } from "./rules";

// Walk batch 3's upload S6 (phone, 11-20, 14 months of Wells Fargo checking): $200 on the 20th every
// month, "ONLINE TRANSFER TO ALLY BANK SAVINGS", was filed as a move between the person's own
// accounts, not as money put into savings, so "how much do I put into savings each month?" got
// "none". A transfer to a savings bank's savings is a transfer to savings, however long the line;
// a payment app's line to a person, one from savings, a person's named savings and a payment to a
// bank with "Savings" in its name are not.

const filed = (description: string, amountCents: number) =>
  categorizeByRules({ description, amountCents, hints: {} })?.detailed;

describe("a bank transfer to savings at another bank", () => {
  it.each([
    "ONLINE TRANSFER TO ALLY BANK SAVINGS",
    "ONLINE TRANSFER TO ALLY BANK SAVINGS XXXXXX4821 REF #IBE4TQ7WZN ON 10/20/26 CONF# 0193847",
    "TRANSFER TO MARCUS BY GOLDMAN SACHS ONLINE SAVINGS ACCT ENDING 7731",
    "Online Transfer to Capital One 360 Performance Savings ...6789 transaction#: 18293746501",
    "XFER TO DISCOVER BANK SAVINGS WEB ID 9000123456",
  ])("going out is a transfer to savings: %s", (description) => {
    expect(filed(description, 20_000)).toBe("TRANSFER_OUT_SAVINGS");
  });

  it.each([
    "ONLINE TRANSFER FROM ALLY BANK SAVINGS XXXXXX4821 REF #IBF2KQ9XWM ON 11/05/26",
    "TRANSFER FROM MARCUS ONLINE SAVINGS ACCT ENDING 7731",
  ])("coming back is money in from savings: %s", (description) => {
    expect(filed(description, -10_000)).toBe("TRANSFER_IN_SAVINGS");
  });

  it.each([
    // To a person, by a payment app.
    "ZELLE TO JORDAN SAVINGS CLUB ON 11/01 REF # PP0QWERTY12",
    // Out of savings, to checking.
    "ONLINE TRANSFER TO CHK ...1234 FROM SAVINGS ...9876 TRANSACTION#: 18293746501",
    // Savings named nowhere.
    "ONLINE TRANSFER TO CHK ...1234 TRANSACTION#: 18293746501",
  ])("leaves other transfers out as they were: %s", (description) => {
    expect(filed(description, 20_000)).not.toBe("TRANSFER_OUT_SAVINGS");
  });

  // A bank with "Savings" in its name that takes loan and card payments (manager, 11-20): filed as
  // savings, the payment would drop out of the bills and raise safe to spend. Each stays as main
  // files it.
  it.each([
    [
      "ONLINE TRANSFER TO THIRD FEDERAL SAVINGS AND LOAN MTG PMT 0044821",
      "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
    ],
    ["TRANSFER TO DOLLAR SAVINGS BANK MORTGAGE", "LOAN_PAYMENTS_MORTGAGE_PAYMENT"],
    ["XFER TO EMIGRANT SAVINGS BANK AUTO LOAN 7781", "LOAN_PAYMENTS_CAR_PAYMENT"],
    ["TRANSFER TO CITIZENS SAVINGS BANK CREDIT CARD PYMT", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
  ])("a payment to a savings-named bank is no transfer to savings: %s", (description, category) => {
    expect(filed(description, 50_000)).toBe(category);
  });

  // A person's name between: the line can't say the savings is theirs, so it stays a transfer, as
  // on main (and as a bill when it repeats), not money the person put away.
  it("leaves a transfer to someone's named savings as a transfer", () => {
    expect(filed("TRANSFER TO JORDAN LEE SAVINGS", 20_000)).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
  });

  it("keeps a landlord transfer as rent", () => {
    expect(filed("ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9", 165_000)).toBe(
      "RENT_AND_UTILITIES_RENT",
    );
  });
});
