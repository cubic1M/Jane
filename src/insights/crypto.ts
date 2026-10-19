import {
  CRYPTO_FEE_FLAG_BPS,
  CRYPTO_SHARE_FLAG,
  CRYPTO_STALE_HOURS,
  LOW_COST_CRYPTO_FEE_BPS,
} from "@/config/crypto";

// Crypto, sized (spec step 161). Pure: what it's worth, its share of everything invested,
// and the two flags: too big a share, and fees well above what low-cost exchanges charge.

export type CryptoSize = {
  totalCents: number;
  // Of everything invested, crypto included.
  share: number;
  overShare: boolean;
  gainCents: number | null;
};

export function cryptoSize(
  holdings: { valueCents: number; costBasisCents: number | null }[],
  investedCents: number,
): CryptoSize {
  const totalCents = holdings.reduce((s, h) => s + h.valueCents, 0);
  const all = investedCents + totalCents;
  const share = all > 0 ? totalCents / all : 0;
  const known = holdings.every((h) => h.costBasisCents !== null);
  return {
    totalCents,
    share,
    overShare: share > CRYPTO_SHARE_FLAG,
    gainCents:
      known && holdings.length > 0
        ? holdings.reduce((s, h) => s + h.valueCents - (h.costBasisCents ?? 0), 0)
        : null,
  };
}

export type CryptoFees = {
  feesCents: number;
  tradedCents: number;
  // Fees as a share of what was traded, in basis points; null with nothing traded.
  bps: number | null;
  flag: boolean;
  // The same trades at a low-cost exchange's fees, a year.
  lowCostCents: { lowCents: number; highCents: number };
};

export function cryptoFees(feesCents: number, tradedCents: number): CryptoFees {
  const bps = tradedCents > 0 ? Math.round((feesCents / tradedCents) * 10_000) : null;
  return {
    feesCents,
    tradedCents,
    bps,
    flag: bps !== null && bps > CRYPTO_FEE_FLAG_BPS,
    lowCostCents: {
      lowCents: Math.round((tradedCents * LOW_COST_CRYPTO_FEE_BPS.low) / 10_000),
      highCents: Math.round((tradedCents * LOW_COST_CRYPTO_FEE_BPS.high) / 10_000),
    },
  };
}

// A balance the source reported too long ago is labelled as out of date.
export const isStale = (asOf: Date, now: Date) =>
  now.getTime() - asOf.getTime() > CRYPTO_STALE_HOURS * 3_600_000;
