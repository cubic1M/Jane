import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRYPTO_EVIDENCE } from "@/config/crypto-evidence";
import { CRYPTO_STRATEGY_IDS } from "@/config/crypto-strategies";
import { realCryptoBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import { alignCrypto, cryptoReplay, cryptoResult, cryptoWeights } from "./crypto-strategies";

// Crypto strategies replayed: weights from the closes before each day, costs on every trade,
// parameters chosen on the earlier years only, and the committed evidence the fixture's own.
// CRYPTO_WRITE=1 writes the evidence afresh.

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

describe("cryptoWeights", () => {
  const day = (n: number) => new Date(Date.UTC(2020, 0, 1 + n)).toISOString().slice(0, 10);
  const up = (k: number) => 100 + k;
  const down = (k: number) => 400 - k;
  const bars = (f: (k: number) => number): Bar[] =>
    Array.from({ length: 300 }, (_, k) => ({ date: day(k), closeCents: f(k) * 100 }));
  const u = alignCrypto({ BTC: bars(up), ETH: bars(down) })!;

  it("holds a rising coin and steps out of a falling one", () => {
    expect(cryptoWeights("crypto_trend", 50, u, 250)).toEqual({ BTC: 0.5, ETH: 0 });
    expect(cryptoWeights("crypto_momentum", 30, u, 250)).toEqual({ BTC: 1, ETH: 0 });
    expect(cryptoWeights("crypto_hold", 0, u, 250)).toEqual({ BTC: 0.5, ETH: 0.5 });
  });

  it("decides from the closes before the day", () => {
    const later = {
      ...u,
      closes: { BTC: u.closes.BTC.map((x, k) => (k >= 250 ? 1 : x)), ETH: u.closes.ETH },
    };
    expect(cryptoWeights("crypto_trend", 50, later, 250)).toEqual(
      cryptoWeights("crypto_trend", 50, u, 250),
    );
  });

  it("pays for every trade", () => {
    const flat = alignCrypto({ BTC: bars(() => 100), ETH: bars(() => 100) })!;
    const r = cryptoReplay(flat, "crypto_hold", 0, null, null)!;
    expect(r.path.at(-1)!.valueCents).toBeLessThan(1_000_000);
    expect(r.metrics.trades).toBeGreaterThan(0);
  });
});

describe("on real closes (the fixture)", () => {
  const u = alignCrypto(realCryptoBars())!;

  it.runIf(process.env.CRYPTO_WRITE)("writes the evidence", () => {
    const rows = CRYPTO_STRATEGY_IDS.map((id) => {
      const r = cryptoResult(u, id)!;
      const m = (x: typeof r.later) => ({
        from: x.from,
        to: x.to,
        cagr: r4(x.cagr),
        maxDrawdown: r4(x.maxDrawdown),
        vol: r4(x.vol),
        sortino: r4(x.sortino),
        trades: x.trades,
      });
      return `  ${id}: ${JSON.stringify({ param: r.param, train: m(r.train), later: m(r.later), holdLater: m(r.holdLater), beatsHolding: r.beatsHolding, curve: r.curve })},`;
    });
    writeFileSync(
      "src/config/crypto-evidence.ts",
      `import type { CryptoStrategyId } from "@/config/crypto-strategies";

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
${rows.join("\n")}
};
`,
    );
  });

  it.each(CRYPTO_STRATEGY_IDS)("%s: the committed evidence is the replay's own", (id) => {
    const fresh = cryptoResult(u, id)!;
    const kept = CRYPTO_EVIDENCE[id];
    expect(kept.param).toBe(fresh.param);
    expect(kept.beatsHolding).toBe(fresh.beatsHolding);
    expect(kept.later.cagr).toBeCloseTo(fresh.later.cagr, 3);
    expect(kept.later.maxDrawdown).toBeCloseTo(fresh.later.maxDrawdown, 3);
    expect(kept.holdLater.sortino).toBeCloseTo(fresh.holdLater.sortino, 3);
  });
});
