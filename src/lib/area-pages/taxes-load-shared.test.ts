import { beforeEach, describe, expect, it, vi } from "vitest";

// CodeRabbit sweep 1c, area-02 (#4, #12): the Taxes page reads the investment taxes once and hands
// that read to the giving and plan loaders, and orders its suggestions best first with the key as
// the tie-break.

const { findMany, loadInvestmentTaxes, loadGiving, loadTaxPlan, day } = vi.hoisted(() => {
  const investments = { taxableAccounts: 0, holdingsKnown: false, washSales: [], harvest: [] };
  return {
    day: { today: "2026-11-19" },
    findMany: vi.fn(async (_args: { orderBy: unknown }) => []),
    loadInvestmentTaxes: vi.fn(async () => investments),
    loadGiving: vi.fn(async (_id: string, _o: { loaded: { investments: unknown } }) => ({
      totalCents: 0,
      receiptsMissing: [],
      advice: false,
      dismissed: false,
      options: [],
    })),
    loadTaxPlan: vi.fn(async (_id: string, _o: { loaded: { investments: unknown } }) => ({
      moves: [],
    })),
  };
});

vi.mock("@/lib/db-scoped", () => ({ scopedFor: () => ({ suggestions: { findMany } }) }));
vi.mock("@/lib/today", () => ({ todayOf: async () => day.today }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => true }));
vi.mock("@/lib/investment-taxes", () => ({ loadInvestmentTaxes }));
vi.mock("@/lib/giving", () => ({ loadGiving }));
vi.mock("@/lib/tax-plan", () => ({ loadTaxPlan }));
vi.mock("@/lib/area-pages/taxes", () => ({ taxesTree: () => ({}) }));
vi.mock("@/lib/tax-organizer", () => ({
  loadTaxTags: async () => ({ checks: [], tagged: [] }),
}));
vi.mock("@/lib/tax-estimate", () => ({
  loadTaxEstimate: async () => ({
    year: 2026,
    estimate: { refundCents: 0, totalTaxCents: 0, totalIncomeCents: 0 },
    withholdingKnown: false,
    w4: null,
  }),
}));
vi.mock("@/lib/tax-set-aside", () => ({
  loadTaxSetAside: async () => ({
    status: "unknown",
    advice: true,
    holdCents: 0,
    confidence: { percent: 0 },
    estimateView: { corrections: [] },
  }),
}));
vi.mock("@/lib/tax-withholding", () => ({ checkFrom: () => ({ status: "unknown" }) }));
vi.mock("@/lib/tax-savings", () => ({
  loadTaxSavings: async () => ({ advice: true, savings: [] }),
}));
vi.mock("@/lib/tax-profile", () => ({
  loadWorkingProfile: async () => ({
    view: {
      filingStatus: { value: null, status: "missing" },
      dependants: { status: "missing" },
      state: { value: null, status: "missing" },
      incomeKinds: { value: [], status: "missing" },
      newIncome: [],
      complete: false,
    },
    taxes: {},
  }),
}));
vi.mock("@/lib/tax-refund", () => ({ loadRefunds: async () => ({ refunds: [] }) }));
vi.mock("@/lib/side-income", () => ({
  loadSideIncome: async () => ({ rental: null, platforms: [] }),
}));
vi.mock("@/lib/audit-records", () => ({
  loadAuditRecords: async () => ({ items: [], gaps: [], retention: [] }),
}));
vi.mock("@/lib/home-taxes", () => ({ loadHomeTaxes: async () => ({ homeowner: false }) }));
vi.mock("@/lib/family-taxes", () => ({
  loadFamilyTaxes: async () => ({ advice: false, choices: [] }),
}));
vi.mock("@/lib/tax-documents", () => ({ loadTaxDocuments: async () => ({ forms: [] }) }));

import { NoTaxParamsError } from "@/config/tax-params";
import { loadTaxesArea } from "./taxes-load";

describe("the Taxes page's shared loads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    day.today = "2026-11-19";
  });

  it("reads the investment taxes once and shares that read", async () => {
    await loadTaxesArea("u1", { now: new Date("2026-11-19T12:00:00Z") });
    expect(loadInvestmentTaxes).toHaveBeenCalledTimes(1);
    const shared = loadInvestmentTaxes.mock.results[0]!.value;
    expect(loadGiving.mock.calls[0]![1].loaded.investments).toBe(shared);
    expect(loadTaxPlan.mock.calls[0]![1].loaded.investments).toBe(shared);
  });

  it("refuses a year with no IRS figures before reading anything (W-N)", async () => {
    // From May 1, 2028 the year gathered is 2028, which has no parameters.
    day.today = "2028-05-01";
    await expect(
      loadTaxesArea("u1", { now: new Date("2028-05-01T19:00:00Z") }),
    ).rejects.toBeInstanceOf(NoTaxParamsError);
    expect(loadInvestmentTaxes).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    // Until the end of April it is still 2027's.
    day.today = "2028-04-30";
    await expect(
      loadTaxesArea("u1", { now: new Date("2028-04-30T19:00:00Z") }),
    ).resolves.toBeDefined();
  });

  it("orders suggestions by score, then key", async () => {
    await loadTaxesArea("u1", { now: new Date("2026-11-19T12:00:00Z") });
    expect(findMany.mock.calls[0]![0].orderBy).toEqual([{ score: "desc" }, { key: "asc" }]);
  });
});
