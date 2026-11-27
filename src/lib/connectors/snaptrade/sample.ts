import type { SnaptradeAccount, SnaptradePositions } from "./api";

// SnapTrade's own examples (docs.snaptrade.com, API reference: List All User Accounts' investment
// account and List All Account Positions' stock, mutual fund and option positions, read 2026-11-19),
// cut to the fields Jane reads. The reference gives one example value per field, so both securities
// carry its units, price and cost basis. The tests read them as SnapTrade sends them; the sandbox
// twin dates them to the person's day and makes the account's total what its positions add up to.

export const SNAPTRADE_DOCS_ACCOUNT: SnaptradeAccount = {
  kind: "investment",
  id: "917c8734-8470-4a3e-a18f-57c3f2ee6631",
  connection_id: "87b24961-b51e-4db8-9226-f198f6518a89",
  status: "open",
  display_name: "Robinhood Individual",
  masked_account_number: "****8443",
  raw_type: "Margin",
  is_paper: false,
  net_value: { amount: 84213.55, currency: "USD" },
};

export const SNAPTRADE_DOCS_POSITIONS: SnaptradePositions = {
  results: [
    {
      instrument: {
        kind: "stock",
        id: "1ef3a5d3-4a9b-40b2-b8d1-cc35f74d6324",
        symbol: "AAPL",
        raw_symbol: "AAPL",
        description: "Apple Inc.",
        currency: "USD",
      },
      units: "10.5",
      price: "123.45",
      cost_basis: "118.2",
      currency: "USD",
    },
    {
      instrument: {
        kind: "mutualfund",
        id: "7a1f0c2e-5b8d-4e3a-9c64-2d9b1e0f8a37",
        symbol: "VFIAX",
        raw_symbol: "VFIAX",
        description: "Vanguard 500 Index Fund Admiral Shares",
        currency: "USD",
      },
      units: "10.5",
      price: "123.45",
      cost_basis: "118.2",
      currency: "USD",
      cash_equivalent: false,
    },
    {
      instrument: { kind: "option", symbol: "AAPL  261218C00250000", currency: "USD" },
      units: "1",
      price: "4.1",
      cost_basis: "3.2",
      currency: "USD",
    },
  ],
  data_freshness: { as_of: "2026-06-02T14:30:00Z" },
};

// The same account for a sample-data person.
export function sampleAccount(): SnaptradeAccount {
  // Each position's value rounded to the cent, as Jane saves it, so the total and the holdings agree.
  const cents = SNAPTRADE_DOCS_POSITIONS.results
    .filter((p) => p.instrument.kind !== "option")
    .reduce((sum, p) => sum + Math.round(Number(p.units) * Number(p.price) * 100), 0);
  return { ...SNAPTRADE_DOCS_ACCOUNT, net_value: { amount: cents / 100, currency: "USD" } };
}

// Its positions, priced as of `today` (YYYY-MM-DD, the person's day).
export function samplePositions(today: string): SnaptradePositions {
  return { ...SNAPTRADE_DOCS_POSITIONS, data_freshness: { as_of: `${today}T14:30:00Z` } };
}
