import type { Holding, InvestmentTransaction, Security } from "plaid";
import { describe, expect, it } from "vitest";
import { normalizeHolding, normalizeInvestmentTransaction, normalizeSecurity } from "./investments";

// Spec step 128: Plaid Investments in the app's shapes.

describe("Plaid Investments, normalized", () => {
  it("turns a holding's dollars into cents and keeps its cost basis", () => {
    expect(
      normalizeHolding({
        account_id: "a",
        security_id: "s",
        quantity: 1.5,
        institution_price: 412.371,
        institution_price_as_of: "2026-10-16",
        institution_value: 618.56,
        cost_basis: 500,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      } as Holding),
    ).toEqual({
      accountRef: "a",
      securityRef: "s",
      quantity: 1.5,
      priceCents: 41_237,
      priceAsOf: "2026-10-16",
      valueCents: 61_856,
      costBasisCents: 50_000,
    });
  });

  it("leaves out holdings and transactions in other currencies", () => {
    expect(
      normalizeHolding({ iso_currency_code: "EUR", institution_value: 1 } as Holding),
    ).toBeNull();
    expect(
      normalizeInvestmentTransaction({
        iso_currency_code: null,
        unofficial_currency_code: "BTC",
      } as InvestmentTransaction),
    ).toBeNull();
  });

  it("names a security even when Plaid doesn't", () => {
    expect(normalizeSecurity({ security_id: "c", name: null, type: "cash" } as Security).name).toBe(
      "Cash",
    );
    expect(
      normalizeSecurity({ security_id: "x", name: " ", ticker_symbol: "VTI" } as Security).name,
    ).toBe("VTI");
  });

  it("keeps Plaid's sign on investment transactions", () => {
    expect(
      normalizeInvestmentTransaction({
        investment_transaction_id: "t",
        account_id: "a",
        security_id: null,
        date: "2026-10-01",
        name: "DIVIDEND",
        quantity: 0,
        amount: -9.88,
        price: 0,
        fees: null,
        type: "cash",
        subtype: "dividend",
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      } as InvestmentTransaction),
    ).toMatchObject({ amountCents: -988, feesCents: null, securityRef: null, subtype: "dividend" });
  });
});
