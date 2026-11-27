import { describe, expect, it } from "vitest";
import { snaptradeRead } from "./normalize";
import { SNAPTRADE_DOCS_ACCOUNT, SNAPTRADE_DOCS_POSITIONS } from "./sample";

// CodeRabbit sweep part 4 (P4-O23): securities are keyed by SnapTrade's own instrument id
// (positions' instrument.id, docs.snaptrade.com List All Account Positions), never by ticker.

const stock = SNAPTRADE_DOCS_POSITIONS.results[0]!;
const read = (...results: (typeof stock)[]) => snaptradeRead(SNAPTRADE_DOCS_ACCOUNT, { results });

describe("a security is its SnapTrade instrument, not its ticker", () => {
  it("keeps two instruments that share a ticker apart", () => {
    const other = { ...stock, instrument: { ...stock.instrument, id: "other-listing-id" } };
    const both = read(stock, other).holdings;
    expect(both).toHaveLength(2);
    expect(new Set(both.map((h) => h.ref)).size).toBe(2);
  });

  it("adds two lines of one instrument, and says the old ticker key for re-keying", () => {
    const [one] = read(stock, stock).holdings;
    expect(one?.ref).toBe(`snaptrade:${stock.instrument.id}`);
    expect(one?.tickerRef).toBe("snaptrade:AAPL");
  });

  it("leaves out a position with no instrument id, and counts it", () => {
    const none = read({ ...stock, instrument: { ...stock.instrument, id: null } });
    expect(none.holdings).toEqual([]);
    expect(none.leftOut).toBe(1);
  });

  it("rounds the combined unit price once, after every line", () => {
    const line = (units: string, price: string) => ({ ...stock, units, price });
    // 1 unit at $1.00, $1.01 and $1.00: the weighted price is $1.00333, which is 100 cents.
    const [one] = read(line("1", "1.00"), line("1", "1.01"), line("1", "1.00")).holdings;
    expect(one?.priceCents).toBe(100);
  });
});
