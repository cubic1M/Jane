import type { CryptoStrategyId } from "@/config/crypto-strategies";

// Each crypto strategy on real daily closes (src/planning/crypto-strategies.ts on
// src/lib/market/__fixtures__/real/crypto.csv, Yahoo Finance): its parameter chosen on the years
// to CRYPTO_TRAIN_END, then its result on the later years against simply holding, after fees and
// slippage, and its curve over those years from 100. Written by CRYPTO_WRITE=1 npx vitest run
// src/planning/crypto-strategies.test.ts, which otherwise checks these are the fixture's own. A
// replay of the past, not a forecast. Fractions throughout.

export type CryptoPeriod = {
  from: string;
  to: string;
  cagr: number;
  maxDrawdown: number;
  vol: number;
  sortino: number;
  trades: number;
};
export type CryptoRecord = {
  param: number;
  train: CryptoPeriod;
  later: CryptoPeriod;
  holdLater: CryptoPeriod;
  beatsHolding: boolean;
  curve: number[];
};

export const CRYPTO_EVIDENCE_SOURCE = "Yahoo Finance daily closes for BTC-USD and ETH-USD";

export const CRYPTO_EVIDENCE: Readonly<Record<CryptoStrategyId, CryptoRecord>> = {
  crypto_hold: {
    param: 0,
    train: {
      from: "2018-07-21",
      to: "2021-12-31",
      cagr: 0.8568,
      maxDrawdown: 0.7355,
      vol: 0.8024,
      sortino: 1.5194,
      trades: 80,
    },
    later: {
      from: "2022-01-01",
      to: "2026-10-21",
      cagr: 0.0315,
      maxDrawdown: 0.683,
      vol: 0.5716,
      sortino: 0.0799,
      trades: 96,
    },
    holdLater: {
      from: "2022-01-01",
      to: "2026-10-21",
      cagr: 0.0315,
      maxDrawdown: 0.683,
      vol: 0.5716,
      sortino: 0.0799,
      trades: 96,
    },
    beatsHolding: false,
    curve: [
      100, 88.8, 94.4, 58.1, 34.5, 52, 38.7, 34.9, 34.3, 43.6, 52, 53, 58.1, 56.5, 49.7, 62.6, 77.5,
      75.8, 115.8, 108.6, 115.6, 104.1, 89.1, 102.6, 156.7, 139.2, 99.4, 101.7, 130, 168.5, 181.7,
      174.7, 140.4, 129.9, 95.8, 107.6, 83, 88.9, 114.4, 116.1,
    ],
  },
  crypto_trend: {
    param: 50,
    train: {
      from: "2018-07-21",
      to: "2021-12-31",
      cagr: 1.2665,
      maxDrawdown: 0.4673,
      vol: 0.5651,
      sortino: 3.4002,
      trades: 180,
    },
    later: {
      from: "2022-01-01",
      to: "2026-10-21",
      cagr: 0.0835,
      maxDrawdown: 0.4556,
      vol: 0.3584,
      sortino: 0.348,
      trades: 215,
    },
    holdLater: {
      from: "2022-01-01",
      to: "2026-10-21",
      cagr: 0.0315,
      maxDrawdown: 0.683,
      vol: 0.5716,
      sortino: 0.0799,
      trades: 96,
    },
    beatsHolding: true,
    curve: [
      100, 102.2, 107.6, 94.1, 94.1, 116, 87.3, 70.3, 69.3, 83, 83.9, 87.8, 84, 81.2, 81.2, 92.5,
      114.5, 112.5, 147.5, 149.1, 134.3, 117.7, 107, 104.1, 134.9, 104.5, 103.2, 107, 135.9, 168.3,
      176.6, 151.3, 145.8, 135.3, 133.7, 132.9, 122, 124.9, 146, 147,
    ],
  },
  crypto_momentum: {
    param: 30,
    train: {
      from: "2018-07-21",
      to: "2021-12-31",
      cagr: 0.9545,
      maxDrawdown: 0.6718,
      vol: 0.7345,
      sortino: 1.9258,
      trades: 75,
    },
    later: {
      from: "2022-01-01",
      to: "2026-10-21",
      cagr: 0.2123,
      maxDrawdown: 0.5003,
      vol: 0.4423,
      sortino: 0.743,
      trades: 115,
    },
    holdLater: {
      from: "2022-01-01",
      to: "2026-10-21",
      cagr: 0.0315,
      maxDrawdown: 0.683,
      vol: 0.5716,
      sortino: 0.0799,
      trades: 96,
    },
    beatsHolding: true,
    curve: [
      100, 96.5, 106.4, 90.5, 90.5, 110.7, 88.4, 82.2, 78.4, 89.9, 92.5, 85.8, 81.9, 78.3, 77.6,
      103.5, 125.7, 113, 150, 137.4, 118.1, 102.5, 98.6, 118.2, 159.6, 139.3, 132.4, 142.2, 159.1,
      213.7, 251.7, 236.4, 219.1, 193.4, 191.3, 187.7, 182.2, 189.7, 254.3, 252.2,
    ],
  },
};
