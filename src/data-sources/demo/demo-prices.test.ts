import { describe, expect, it } from "vitest";
import { addDays } from "./demo-bank";
import { DEMO_PRICE_PROFILES, demoPrice } from "./demo-prices";

// Spec step 156: the stand-in price feed.

const ANCHOR = "2026-10-18";

describe("demoPrice", () => {
  it("is the demo bank's own price on the anchor's eve, so the first sync is unchanged", () => {
    for (const [ticker, p] of Object.entries(DEMO_PRICE_PROFILES)) {
      expect(demoPrice(ticker, addDays(ANCHOR, -1), ANCHOR), ticker).toBe(p.base);
    }
  });

  it("moves a little every day, the same way every time", () => {
    const later = demoPrice("KTSIX", "2026-11-18", ANCHOR)!;
    expect(later).not.toBe(142.18);
    expect(demoPrice("KTSIX", "2026-11-18", ANCHOR)).toBe(later);
    // A year earlier exists too, for returns.
    expect(demoPrice("KTSIX", "2025-10-17", ANCHOR)).toBeGreaterThan(0);
    for (let i = 1; i < 30; i += 1) {
      const a = demoPrice("KTSIX", addDays(ANCHOR, i - 1), ANCHOR)!;
      const b = demoPrice("KTSIX", addDays(ANCHOR, i), ANCHOR)!;
      expect(Math.abs(b / a - 1)).toBeLessThan(0.08);
    }
  });

  it("keeps cash at a dollar and knows only its own funds", () => {
    expect(demoPrice("DSVXX", "2026-12-01", ANCHOR)).toBe(1);
    expect(demoPrice("CASH", "2026-12-01", ANCHOR)).toBe(1);
    expect(demoPrice("VTI", "2026-12-01", ANCHOR)).toBeNull();
  });

  it("moves stock funds together and bonds less", () => {
    const moves = (ticker: string) =>
      Array.from({ length: 200 }, (_, i) => {
        const a = demoPrice(ticker, addDays("2026-01-01", i), ANCHOR)!;
        const b = demoPrice(ticker, addDays("2026-01-01", i + 1), ANCHOR)!;
        return Math.log(b / a);
      });
    const spread = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
    expect(spread(moves("KTBIX"))).toBeLessThan(spread(moves("KTSIX")));
    const a = moves("KTSIX");
    const b = moves("KLCX");
    const corr = a.reduce((s, x, i) => s + x * b[i], 0) / (spread(a) * spread(b) * a.length);
    expect(corr).toBeGreaterThan(0.5);
  });
});
