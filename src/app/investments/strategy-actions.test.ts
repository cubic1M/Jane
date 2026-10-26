import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/practice/preferences", () => ({
  practiceProfileOf: vi.fn(async () => ({ level: 5 })),
  savePreferences: vi.fn(async () => ({ ok: true })),
}));

import { redirect } from "next/navigation";
import { adviceMode } from "@/lib/advice-mode";
import { practiceProfileOf, savePreferences } from "@/lib/practice/preferences";
import { CATALOG_EVIDENCE } from "@/config/catalog-evidence";
import { CATALOG, CATALOG_IDS } from "@/config/strategy-catalog";
import {
  choosePracticeStrategy,
  restorePracticeStrategy,
  usePracticeCatalog,
  usePracticeCrypto,
  usePracticeDayTrading,
  usePracticeStrategy,
} from "./strategy-actions";

// The strategy menu's buttons: demo advice only, Very high only for the crypto and day-trading
// sleeves (off always allowed), only known choices, and back to the same card.

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describe("the strategy menu's buttons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("save a known choice and come back to the same card", async () => {
    await usePracticeStrategy(form({ strategy: "value_tilt" }));
    await usePracticeCrypto(form({ sleeve: "crypto_trend" }));
    await usePracticeDayTrading(form({ rule: "vwap_reversion" }));
    expect(vi.mocked(savePreferences).mock.calls.map((c) => c[1])).toEqual([
      { strategy: "value_tilt" },
      { cryptoSleeve: "crypto_trend" },
    ]);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/investments");
  });

  it("never change a real account's settings", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    await usePracticeStrategy(form({ strategy: "value_tilt" }));
    await usePracticeCrypto(form({ sleeve: "crypto_trend" }));
    await usePracticeDayTrading(form({ rule: "vwap_reversion" }));
    expect(savePreferences).not.toHaveBeenCalled();
    vi.mocked(adviceMode).mockResolvedValue(true);
  });

  it("turn a sleeve on at Very high only, off at any level, and refuse unknown choices", async () => {
    vi.mocked(practiceProfileOf).mockResolvedValue({ level: 3 } as never);
    await usePracticeCrypto(form({ sleeve: "crypto_trend" }));
    await usePracticeDayTrading(form({ rule: "opening_range" }));
    await usePracticeCrypto(form({ sleeve: "off" }));
    await usePracticeStrategy(form({ strategy: "moonshot" }));
    expect(vi.mocked(savePreferences).mock.calls.map((c) => c[1])).toEqual([
      { cryptoSleeve: "off" },
    ]);
  });

  it("follows any tested strategy that runs on its own, never a sleeve", async () => {
    vi.mocked(practiceProfileOf).mockResolvedValue({ level: 3 } as never);
    const watched = CATALOG_IDS.find((id) => CATALOG_EVIDENCE[id]?.[3]?.watch)!;
    const not = CATALOG_IDS.find((id) => {
      const e = CATALOG_EVIDENCE[id]?.[3];
      return e && !e.watch && !e.recommendable && CATALOG[id].kind !== "sleeve";
    })!;
    await usePracticeCatalog(form({ strategy: watched }));
    await usePracticeCatalog(form({ strategy: not }));
    await usePracticeCatalog(form({ strategy: "managed_futures" }));
    await usePracticeCatalog(form({ strategy: "off" }));
    expect(vi.mocked(savePreferences).mock.calls.map((c) => c[1])).toEqual([
      { catalogStrategy: watched },
      { catalogStrategy: not },
      { catalogStrategy: "off" },
    ]);
  });
});

// The strategy tree's "Use this strategy" and Revert: instant on the page, saved behind, with
// what it replaced handed back for Revert.
describe("Use this strategy and Revert", () => {
  const before = { catalogStrategy: "off", strategy: "level", cryptoSleeve: "off", riskLevel: 3 };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adviceMode).mockResolvedValue(true);
    vi.mocked(savePreferences).mockResolvedValue({ ok: true, before } as never);
  });

  it("saves a leaf by its key and hands back what it replaced, with no redirect", async () => {
    vi.mocked(practiceProfileOf).mockResolvedValue({ level: 3 } as never);
    expect(await choosePracticeStrategy("catalog:haa")).toEqual({
      ok: true,
      previous: { catalogStrategy: "off", strategy: "level", cryptoSleeve: "off" },
    });
    await choosePracticeStrategy("default");
    expect(vi.mocked(savePreferences).mock.calls.map((c) => c[1])).toEqual([
      { catalogStrategy: "haa" },
      { catalogStrategy: "off", strategy: "level" },
    ]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuses day trading, sleeves, unknown keys, crypto below Very high and real accounts", async () => {
    vi.mocked(practiceProfileOf).mockResolvedValue({ level: 3 } as never);
    for (const key of [
      "intraday:opening_range",
      "catalog:managed_futures",
      "catalog:moonshot",
      "crypto:crypto_trend",
      "nothing",
    ])
      expect((await choosePracticeStrategy(key)).ok, key).toBe(false);
    vi.mocked(practiceProfileOf).mockResolvedValue({ level: 5 } as never);
    expect((await choosePracticeStrategy("crypto:crypto_trend")).ok).toBe(true);
    vi.mocked(adviceMode).mockResolvedValue(false);
    expect(await choosePracticeStrategy("catalog:haa")).toMatchObject({ ok: false });
    expect(vi.mocked(savePreferences).mock.calls.map((c) => c[1])).toEqual([
      { cryptoSleeve: "crypto_trend" },
    ]);
  });

  it("Revert puts back exactly what was there", async () => {
    await restorePracticeStrategy({
      catalogStrategy: "eaa",
      strategy: "value_tilt",
      cryptoSleeve: "off",
    });
    expect(vi.mocked(savePreferences).mock.calls[0][1]).toEqual({
      catalogStrategy: "eaa",
      strategy: "value_tilt",
      cryptoSleeve: "off",
    });
  });
});
