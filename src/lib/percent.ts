// A share (0.25) as a whole percent ("25%"), rounded.
export const formatPercent = (share: number): string => `${Math.round(share * 100)}%`;

// A share as a percent to one decimal, with no ".0": 0.125 is "12.5%", 0.07 is "7%".
export const formatPercentTenths = (share: number): string => `${Math.round(share * 1000) / 10}%`;

// Basis points as a percent with two decimals: 1999 is "19.99%" (a rate, a fund's yearly cost).
export const formatRate = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

// A fund's yearly cost: two decimals, or three where it holds half a basis point (Fidelity 500
// Index's 0.015%, which two decimals rounded to "0.01%"; src/config/funds.ts).
export const formatExpenseRatio = (bps: number): string =>
  `${(bps / 100).toFixed(Number.isInteger(bps) ? 2 : 3)}%`;
