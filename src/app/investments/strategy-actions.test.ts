import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn((run: () => unknown) => void run()) }));
vi.mock("@/lib/paper/account", () => ({ runPaperDay: vi.fn(async () => ({ ran: true })) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/practice/preferences", () => ({
  practiceProfileOf: vi.fn(async () => ({ level: 5 })),
  savePreferences: vi.fn(async () => ({ ok: true })),
}));

import { redirect } from "next/navigation";
import { runPaperDay } from "@/lib/paper/account";
import { adviceMode } from "@/lib/advice-mode";
import { practiceProfileOf, savePreferences } from "@/lib/practice/preferences";
import { choosePracticeStrategy, restorePracticeStrategy } from "./strategy-actions";

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
    // The paper account picks up the new strategy straight away.
    expect(runPaperDay).toHaveBeenCalledWith("u1");
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
