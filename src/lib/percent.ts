// A share (0.25) as a whole percent ("25%"), rounded.
export const formatPercent = (share: number): string => `${Math.round(share * 100)}%`;

// Basis points as a percent with two decimals: 1999 is "19.99%" (a rate, a fund's yearly cost).
export const formatRate = (bps: number): string => `${(bps / 100).toFixed(2)}%`;
