import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/autopilot", () => ({ markCustom: vi.fn() }));
vi.mock("@/lib/standing-rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/standing-rules")>()),
  saveRules: vi.fn(),
}));

import { RuleError, saveRules } from "@/lib/standing-rules";
import { markCustom } from "@/lib/autopilot";
import { saveStandingRules } from "./rules-actions";

describe("saveStandingRules", () => {
  it("saves every rule for the signed-in person, reading amounts in dollars", async () => {
    const data = new FormData();
    data.set("recover_bank_fees.enabled", "on");
    data.set("recover_bank_fees.limit", "5");
    data.set("fight_price_increases.limit", "3");
    data.set("fight_price_increases.max", "$60");
    expect(await saveStandingRules(null, data)).toMatchObject({ ok: true });
    // Fine-tuning by hand makes the autopilot "custom".
    expect(markCustom).toHaveBeenCalledWith("u1");
    const saved = vi.mocked(saveRules).mock.calls[0];
    expect(saved[0]).toBe("u1");
    expect(saved[1]).toEqual(
      expect.arrayContaining([
        { key: "recover_bank_fees", enabled: true, monthlyLimit: 5, maxAnnualCents: null },
        { key: "fight_price_increases", enabled: false, monthlyLimit: 3, maxAnnualCents: 6_000 },
      ]),
    );
  });

  it("shows rule errors as messages", async () => {
    vi.mocked(saveRules).mockRejectedValueOnce(new RuleError("Pick one of the monthly limits."));
    expect(await saveStandingRules(null, new FormData())).toEqual({
      ok: false,
      message: "Pick one of the monthly limits.",
    });
  });
});
