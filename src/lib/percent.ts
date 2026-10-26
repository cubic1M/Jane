// A share (0.25) as a whole percent ("25%"), rounded.
export const formatPercent = (share: number): string => `${Math.round(share * 100)}%`;
