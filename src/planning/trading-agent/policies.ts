import { CRYPTO_STRATEGIES, CRYPTO_STRATEGY_IDS } from "@/config/crypto-strategies";
import { CATALOG, CATALOG_IDS, type CatalogId } from "@/config/strategy-catalog";
import { AGENT_MARKETS, CASH_TICKER, type AgentMarketId } from "@/config/trading-agent";
import { decide, type Universe } from "@/planning/catalog/strategies";
import { cryptoWeights } from "@/planning/crypto-strategies";
import type { Policy, PolicyContext, Timeline, Weights } from "./types";

// The strategies the 24-hour agent can run (src/planning/trading-agent/), as policies over a
// timeline of bars. The catalog's own rules (src/planning/catalog/strategies.ts) run unchanged,
// bar by bar on the made-up calendar (./clock.ts): a strategy over SPY and bills alone can be
// pointed at bitcoin, ether or QQQ (with plain cash as bills for crypto); the others run on their
// own funds in market hours. The two calendar rules (sell in May, the turn of the month) are left
// out: on a made-up calendar they mean nothing. The crypto rules (src/config/crypto-strategies.ts)
// run on bitcoin and ether. Pure.

// Rules about the real calendar: not run bar by bar.
export const CALENDAR_RULES: readonly CatalogId[] = CATALOG_IDS.filter(
  (id) => CATALOG[id].family === "seasonal",
);
const singleAsset = (id: CatalogId) => CATALOG[id].tickers.every((t) => t === "SPY" || t === "BIL");
export const SINGLE_ASSET_RULES: readonly CatalogId[] = CATALOG_IDS.filter(
  (id) => singleAsset(id) && !CALENDAR_RULES.includes(id),
);

type Mapping = Readonly<Record<string, string>>;

// The catalog's universe over a timeline, its tickers renamed to the market's (SPY to BTC/USD,
// BIL to plain cash), with the next bar's made-up date (and the last close again) at the end so
// a rule can see whether a month ends at the last bar without any price after it.
const universes = new WeakMap<Timeline, Map<string, Universe>>();
function universeOf(tl: Timeline, id: CatalogId, map: Mapping): Universe {
  const key = `${id}|${Object.entries(map).join(";")}`;
  let byKey = universes.get(tl);
  if (!byKey) {
    byKey = new Map();
    universes.set(tl, byKey);
  }
  const found = byKey.get(key);
  if (found) return found;
  const pad = (xs: readonly number[] | undefined) =>
    xs ? [...xs, xs.at(-1) ?? 0] : new Array<number>(tl.times.length + 1).fill(0);
  const closes: Record<string, number[]> = {};
  for (const t of CATALOG[id].tickers) closes[t] = pad(tl.close[map[t] ?? t]);
  const spy = map.SPY ?? "SPY";
  const u: Universe = {
    dates: [...tl.dates, tl.nextDate],
    closes,
    spy: tl.close[spy]
      ? [
          ...tl.times.map((_, i) => ({
            o: tl.open[spy][i],
            h: tl.high[spy][i],
            l: tl.low[spy][i],
            c: tl.close[spy][i],
          })),
          null,
        ]
      : undefined,
  };
  byKey.set(key, u);
  return u;
}

const rename = (w: Weights | null, map: Mapping): Weights | null =>
  w === null
    ? null
    : Object.fromEntries(
        Object.entries(w)
          .filter(([, v]) => v > 0)
          .map(([t, v]) => [map[t] ?? t, v]),
      );

function catalogPolicy(id: CatalogId, map: Mapping, on: string | null): Policy {
  const entry = CATALOG[id];
  const back = Object.fromEntries(Object.entries(map).map(([a, b]) => [b, a]));
  return {
    key: on ? `catalog:${id}@${on}` : `catalog:${id}`,
    label: on ? `${entry.label} on ${on.replace("/USD", "")}` : entry.label,
    tickers: entry.tickers.map((t) => map[t] ?? t),
    grid: entry.grid,
    decide(tl: Timeline, t: number, param: number, ctx: PolicyContext) {
      const u = universeOf(tl, id, map);
      // The catalog's rules see their own tickers' names.
      const held = Object.fromEntries(Object.entries(ctx.held).map(([k, v]) => [back[k] ?? k, v]));
      const own = { value: ctx.value, held, memo: ctx.memo };
      const w = decide(id, param, u, t, own);
      return rename(w, map);
    },
  };
}

// The crypto rules over bitcoin and ether: the daily rules' checks each Monday become each
// made-up week's last bar, their look-backs counted in bars.
const COINS = { BTC: "BTC/USD", ETH: "ETH/USD" } as const;
const weekEnds = (tl: Timeline, t: number) => {
  const next = t + 1 < tl.dates.length ? tl.dates[t + 1] : tl.nextDate;
  const day = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  return day(next) < day(tl.dates[t]);
};
function cryptoPolicy(id: (typeof CRYPTO_STRATEGY_IDS)[number]): Policy {
  const s = CRYPTO_STRATEGIES[id];
  return {
    key: `crypto:${id}`,
    label: s.label,
    tickers: Object.values(COINS),
    grid: s.grid,
    decide(tl: Timeline, t: number, param: number) {
      if (!weekEnds(tl, t)) return null;
      const need = id === "crypto_hold" ? 0 : param + 1;
      if (t < need || Object.values(COINS).some((c) => !(tl.close[c]?.[t - need] > 0))) return null;
      const u = { dates: tl.dates, closes: { BTC: tl.close[COINS.BTC], ETH: tl.close[COINS.ETH] } };
      // The daily rule decides on day t from the closes before it: here, after bar t's close.
      const w = cryptoWeights(id, param, u, t + 1);
      const out: Record<string, number> = {};
      for (const [coin, v] of Object.entries(w))
        if (v > 0) out[COINS[coin as keyof typeof COINS]] = v;
      return out;
    },
  };
}

// Every policy for a market: the single-asset rules on each of its assets, and (in market hours)
// every other catalog rule on its own funds; the crypto rules on crypto.
export function policiesFor(market: AgentMarketId): Policy[] {
  const m = AGENT_MARKETS[market];
  const out: Policy[] = [];
  for (const asset of m.assets)
    for (const id of SINGLE_ASSET_RULES)
      out.push(
        catalogPolicy(id, { SPY: asset, BIL: m.cash === CASH_TICKER ? CASH_TICKER : "BIL" }, asset),
      );
  if (market === "crypto") for (const id of CRYPTO_STRATEGY_IDS) out.push(cryptoPolicy(id));
  else
    for (const id of CATALOG_IDS)
      if (!SINGLE_ASSET_RULES.includes(id) && !CALENDAR_RULES.includes(id))
        out.push(catalogPolicy(id, {}, null));
  return out;
}

export function policyByKey(key: string): Policy | null {
  for (const market of Object.keys(AGENT_MARKETS) as AgentMarketId[]) {
    const p = policiesFor(market).find((x) => x.key === key);
    if (p) return p;
  }
  return null;
}

export const marketOfPolicy = (key: string): AgentMarketId | null => {
  if (key.startsWith("crypto:") || key.endsWith("/USD")) return "crypto";
  return policyByKey(key) ? "stocks" : null;
};
