import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));
vi.mock("@/lib/sector-autopilot", () => ({ mayAct: vi.fn(), recordAct: vi.fn() }));
vi.mock("@/lib/brokerage/partner", () => ({
  brokeragePartner: vi.fn(() => ({ placeOrders: vi.fn(), simulated: true })),
}));
vi.mock("./profile", () => ({ profileOf: vi.fn(async () => ({})) }));
vi.mock("@/planning/investor-profile", () => ({
  profileSummary: vi.fn(() => ({ complete: true, riskLevel: 3 })),
}));
vi.mock("./rebalance", () => ({ loadRebalance: vi.fn(), placeRebalance: vi.fn() }));
vi.mock("@/lib/investment-taxes", () => ({ loadInvestmentTaxes: vi.fn() }));
vi.mock("./holdings", () => ({ loadInvestments: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => ({})) }));

import { adviceMode } from "@/lib/advice-mode";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { runAutomaticInvesting } from "./automatic";
import { loadRebalance, placeRebalance } from "./rebalance";

// Spec step 164: Jane trades without a tap only where adviceMode is on (demo bank people,
// or DEMO_ADVICE=1 in production): never for real accounts while advice is off.

describe("automatic investing and real accounts", () => {
  it("does nothing, and asks nothing of the autopilot, when adviceMode is off", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    // Even if every cap and level said yes.
    vi.mocked(mayAct).mockResolvedValue({ ok: true } as never);
    expect(await runAutomaticInvesting("real-person", { client: {} as never })).toBeNull();
    expect(mayAct).not.toHaveBeenCalled();
    expect(loadRebalance).not.toHaveBeenCalled();
    expect(placeRebalance).not.toHaveBeenCalled();
    expect(brokeragePartner).not.toHaveBeenCalled();
    expect(recordAct).not.toHaveBeenCalled();
  });

  it("only checks the level once adviceMode is on", async () => {
    vi.mocked(adviceMode).mockResolvedValue(true);
    vi.mocked(mayAct).mockResolvedValue({ ok: false, reason: "level" } as never);
    expect(await runAutomaticInvesting("demo-person", { client: {} as never })).toBeNull();
    expect(mayAct).toHaveBeenCalledWith(
      "demo-person",
      "investing",
      { needs: "all", cents: 0 },
      expect.anything(),
    );
    expect(placeRebalance).not.toHaveBeenCalled();
  });
});
