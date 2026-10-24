import type { IntradayRuleId } from "@/config/intraday-strategies";

// Each day-trading rule on real 5-minute bars (src/planning/intraday.ts): its setting chosen on
// the sessions to INTRADAY_TRAIN_END, then its result on the later sessions against holding the
// fund over the same days, after slippage both ways, and its curve over those sessions from 100.
// Written by the strategy research workflow (kind: intraday), whose bars are too many to commit;
// src/planning/intraday.test.ts checks the rules themselves. A replay of the past, not a
// forecast. Fractions throughout.

export type IntradayPeriod = {
  from: string;
  to: string;
  sessions: number;
  trades: number;
  winRate: number;
  averageTrade: number;
  cagr: number;
  maxDrawdown: number;
  vol: number;
  sortino: number;
};
export type IntradayRecord = {
  param: number;
  train: IntradayPeriod;
  later: IntradayPeriod;
  holdLater: IntradayPeriod;
  beatsHolding: boolean;
  curve: number[];
};

export const INTRADAY_EVIDENCE_SOURCE = "Alpaca SIP 5Min bars for SPY, 2016-01-04 to 2026-10-23";

export const INTRADAY_EVIDENCE: Readonly<Record<IntradayRuleId, IntradayRecord>> = {
  opening_range: {
    param: 30,
    train: {
      from: "2016-01-04",
      to: "2023-12-29",
      sessions: 2011,
      trades: 1412,
      winRate: 0.4384,
      averageTrade: -0.0005,
      cagr: -0.0868,
      maxDrawdown: 0.5257,
      vol: 0.0756,
      sortino: -1.5308,
    },
    later: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 492,
      winRate: 0.4187,
      averageTrade: -0.0005,
      cagr: -0.08,
      maxDrawdown: 0.2102,
      vol: 0.0602,
      sortino: -2.0083,
    },
    holdLater: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 0,
      winRate: 0,
      averageTrade: 0,
      cagr: 0.1988,
      maxDrawdown: 0.1871,
      vol: 0.1505,
      sortino: 1.9534,
    },
    beatsHolding: false,
    curve: [
      100, 98.1, 96.9, 95.6, 93.8, 95.4, 95.4, 94.5, 93.4, 94, 92.3, 91.5, 90.8, 91.2, 91.5, 90.6,
      91.9, 90.6, 93.2, 95.8, 94.2, 91.8, 91.6, 90.8, 89.2, 87.4, 87.6, 86.3, 85.8, 84.5, 85.1,
      84.6, 86.7, 86.5, 85.5, 83.7, 82.1, 80.5, 79.7, 79.2,
    ],
  },
  liquidity_sweep: {
    param: 1.5,
    train: {
      from: "2016-01-04",
      to: "2023-12-29",
      sessions: 2011,
      trades: 409,
      winRate: 0.3839,
      averageTrade: -0.0004,
      cagr: -0.0212,
      maxDrawdown: 0.1575,
      vol: 0.0231,
      sortino: -1.495,
    },
    later: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 135,
      winRate: 0.3556,
      averageTrade: -0.001,
      cagr: -0.0454,
      maxDrawdown: 0.1226,
      vol: 0.0276,
      sortino: -1.7266,
    },
    holdLater: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 0,
      winRate: 0,
      averageTrade: 0,
      cagr: 0.1988,
      maxDrawdown: 0.1871,
      vol: 0.1505,
      sortino: 1.9534,
    },
    beatsHolding: false,
    curve: [
      100, 99.7, 100, 99.3, 99.4, 99.3, 99.2, 99.2, 99.1, 99, 98.5, 98, 97.5, 97.3, 96.9, 96.6,
      96.3, 95.3, 92, 91.6, 92, 91.5, 91.5, 91.3, 91.3, 91.2, 90.8, 90.5, 90.2, 90, 90.1, 89.6,
      89.1, 88.6, 88.5, 88.3, 88.3, 88.2, 88.2, 87.8,
    ],
  },
  fair_value_gap: {
    param: 0.001,
    train: {
      from: "2016-01-04",
      to: "2023-12-29",
      sessions: 2011,
      trades: 287,
      winRate: 0.4495,
      averageTrade: 0.0004,
      cagr: 0.0138,
      maxDrawdown: 0.0913,
      vol: 0.043,
      sortino: 0.5902,
    },
    later: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 68,
      winRate: 0.3529,
      averageTrade: -0.0008,
      cagr: -0.0194,
      maxDrawdown: 0.0563,
      vol: 0.0248,
      sortino: -1.1196,
    },
    holdLater: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 0,
      winRate: 0,
      averageTrade: 0,
      cagr: 0.1988,
      maxDrawdown: 0.1871,
      vol: 0.1505,
      sortino: 1.9534,
    },
    beatsHolding: false,
    curve: [
      100, 99.6, 100, 100, 100, 100, 100, 98.9, 98.9, 98.3, 98.9, 99, 99, 99.2, 98.9, 99.2, 98.2,
      98.2, 98.8, 99.3, 99.1, 98.6, 98.6, 98.3, 97.9, 97.9, 97.6, 97.7, 97.4, 96.5, 96.3, 95.7,
      95.6, 95.2, 95.7, 95, 95, 95, 95, 94.7,
    ],
  },
  vwap_reversion: {
    param: 0.006,
    train: {
      from: "2016-01-04",
      to: "2023-12-29",
      sessions: 2011,
      trades: 267,
      winRate: 0.5805,
      averageTrade: -0.0012,
      cagr: -0.0392,
      maxDrawdown: 0.3001,
      vol: 0.039,
      sortino: -1.1333,
    },
    later: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 79,
      winRate: 0.5823,
      averageTrade: -0.0008,
      cagr: -0.0215,
      maxDrawdown: 0.0705,
      vol: 0.0321,
      sortino: -0.7773,
    },
    holdLater: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 0,
      winRate: 0,
      averageTrade: 0,
      cagr: 0.1988,
      maxDrawdown: 0.1871,
      vol: 0.1505,
      sortino: 1.9534,
    },
    beatsHolding: false,
    curve: [
      100, 100, 100, 99.8, 99.5, 100.3, 100.5, 100.5, 100.3, 97.7, 97.9, 97.9, 97.9, 97.9, 98.1,
      98.6, 98.4, 99.2, 96.4, 96.1, 95.5, 95.5, 95.2, 95.2, 95.4, 94.7, 95.1, 94.6, 94.9, 95.7,
      95.3, 95.5, 96.1, 96.1, 93.4, 94.1, 94.3, 94.3, 94.3, 94.1,
    ],
  },
  volume_imbalance: {
    param: 3,
    train: {
      from: "2016-01-04",
      to: "2023-12-29",
      sessions: 2011,
      trades: 19,
      winRate: 0.3158,
      averageTrade: -0.001,
      cagr: -0.0024,
      maxDrawdown: 0.0199,
      vol: 0.0033,
      sortino: -0.773,
    },
    later: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 4,
      winRate: 0.5,
      averageTrade: 0,
      cagr: -0.0001,
      maxDrawdown: 0.0016,
      vol: 0.0015,
      sortino: -0.0574,
    },
    holdLater: {
      from: "2024-01-02",
      to: "2026-10-23",
      sessions: 705,
      trades: 0,
      winRate: 0,
      averageTrade: 0,
      cagr: 0.1988,
      maxDrawdown: 0.1871,
      vol: 0.1505,
      sortino: 1.9534,
    },
    beatsHolding: false,
    curve: [
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99.9, 99.9, 100, 100, 100,
      100, 100, 100, 100, 99.8, 99.8, 99.8, 99.8, 99.8, 99.8, 99.8, 100, 100, 100, 100, 100, 100,
      100, 100, 100, 100, 100,
    ],
  },
};
