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
import { CATALOG_IDS } from "@/config/strategy-catalog";
import {
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
      { dayTrading: "vwap_reversion" },
    ]);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/investments?focus=strategies:menu");
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

  it("follows a tested strategy only where the research rates it worth watching or better", async () => {
    vi.mocked(practiceProfileOf).mockResolvedValue({ level: 3 } as never);
    const ok = CATALOG_IDS.find((id) => CATALOG_EVIDENCE[id]?.[3]?.watch)!;
    const no = CATALOG_IDS.find((id) => {
      const e = CATALOG_EVIDENCE[id]?.[3];
      return e && !e.watch && !e.recommendable;
    })!;
    await usePracticeCatalog(form({ strategy: ok }));
    await usePracticeCatalog(form({ strategy: no }));
    await usePracticeCatalog(form({ strategy: "off" }));
    expect(vi.mocked(savePreferences).mock.calls.map((c) => c[1])).toEqual([
      { catalogStrategy: ok },
      { catalogStrategy: "off" },
    ]);
  });
});
