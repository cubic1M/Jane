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

  // CodeRabbit sweep (ds-02): a figure Plaid leaves out is unknown, never $0.
  it("derives a missing holding value, or leaves the holding out, never counts $0", () => {
    const base = { account_id: "a", security_id: "s", quantity: 2, iso_currency_code: "USD" };
    expect(
      normalizeHolding({ ...base, institution_price: 10, institution_value: null } as never),
    ).toMatchObject({ valueCents: 2000, priceCents: 1000 });
    // A sub-cent price: the total comes from the dollar price, not the price rounded to cents.
    expect(
      normalizeHolding({
        ...base,
        quantity: 100000,
        institution_price: 0.004,
        institution_value: null,
      } as never),
    ).toMatchObject({ valueCents: 40000 });
    expect(
      normalizeHolding({ ...base, institution_price: null, institution_value: 30 } as never),
    ).toMatchObject({ valueCents: 3000, priceCents: 1500 });
    expect(
      normalizeHolding({ ...base, institution_price: null, institution_value: null } as never),
    ).toBeNull();
  });

  it("leaves out an investment transaction with no amount, and fills the text Plaid left null", () => {
    const base = {
      investment_transaction_id: "t",
      account_id: "a",
      date: "2026-10-01",
      iso_currency_code: "USD",
    };
    expect(normalizeInvestmentTransaction({ ...base, amount: null } as never)).toBeNull();
    expect(
      normalizeInvestmentTransaction({
        ...base,
        amount: 5,
        name: null,
        quantity: null,
        type: null,
        subtype: null,
      } as never),
    ).toMatchObject({ amountCents: 500, name: "", quantity: 0, type: "", subtype: "" });
  });

  it("gives no close price in another currency", () => {
    expect(
      normalizeSecurity({ security_id: "x", close_price: 10, iso_currency_code: "EUR" } as Security)
        .closePriceCents,
    ).toBeNull();
    expect(
      normalizeSecurity({ security_id: "x", close_price: 10, iso_currency_code: "USD" } as Security)
        .closePriceCents,
    ).toBe(1000);
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
