import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import type { Comparison, CompareOption, Scored } from "@/planning/compare";
import { doneSaving, orderInProgress, pickLine, snapshotTitle } from "./jane";

// The Jane hub's pure helpers (spec step 80).

const option = (name: string): CompareOption => ({
  id: name,
  kind: "plan",
  category: "phone",
  merchantKey: null,
  provider: name,
  name,
  monthlyCents: 3_000,
  apyBps: null,
  contractMonths: 0,
  oneTimeFeeCents: 0,
  minimumBalanceCents: 0,
  includes: null,
  givesUp: null,
  signUpUrl: null,
  sourceUrl: "https://example.com",
  checkedAt: "2026-10-01",
  demo: false,
});
const scored = (name: string, savingCents: number): Scored => ({
  option: option(name),
  firstYearCents: 36_000,
  savingCents,
  notes: [],
});

describe("pickLine", () => {
  it("is nothing without a comparison", () => {
    expect(pickLine(null)).toBeNull();
  });

  it("names the pick and the first-year saving for a bill", () => {
    const comparison: Comparison = {
      current: { kind: "bill", monthlyCents: 9_000, category: "phone", merchantKey: null },
      currentYearCents: 108_000,
      pick: scored("Pine Mobile Unlimited", 132_000),
      runnersUp: [],
      why: "",
    };
    expect(pickLine(comparison)).toBe(
      "Jane's pick: Pine Mobile Unlimited, saves about $1,320.00 in the first year",
    );
  });

  it("says what more it earns for idle cash", () => {
    const comparison: Comparison = {
      current: { kind: "savings", amountCents: 1_000_000, currentRateBps: 10 },
      currentYearCents: 1_000,
      pick: scored("Cobalt Online Savings", 40_000),
      runnersUp: [],
      why: "",
    };
    expect(pickLine(comparison)).toBe(
      "Jane's pick: Cobalt Online Savings, earns about $400.00 more a year",
    );
  });
});

describe("snapshotTitle", () => {
  it("uses the card's title, or a plain fallback", () => {
    expect(snapshotTitle({ title: "Cancel Netflix" })).toBe("Cancel Netflix");
    expect(snapshotTitle({ title: "" })).toBe("Your request");
    expect(snapshotTitle(null)).toBe("Your request");
    expect(snapshotTitle({ title: 5 })).toBe("Your request");
  });
});

describe("doneSaving", () => {
  const snapshot = { annualSavingsCents: 18_000 };

  it("prefers a refund, then a confirmed price, then the estimate", () => {
    expect(
      doneSaving({ refundCents: 6_420, confirmedAnnualCents: 1_000, cardSnapshot: snapshot }),
    ).toBe("Got back $64.20");
    expect(
      doneSaving({ refundCents: null, confirmedAnnualCents: 12_000, cardSnapshot: snapshot }),
    ).toBe("Saves $120.00 a year, confirmed");
    expect(
      doneSaving({ refundCents: null, confirmedAnnualCents: null, cardSnapshot: snapshot }),
    ).toBe("About $180.00 a year");
  });

  it("says nothing when there's no number", () => {
    expect(
      doneSaving({ refundCents: null, confirmedAnnualCents: null, cardSnapshot: {} }),
    ).toBeNull();
    expect(
      doneSaving({
        refundCents: null,
        confirmedAnnualCents: null,
        cardSnapshot: { annualSavingsCents: null },
      }),
    ).toBeNull();
  });
});

describe("orderInProgress", () => {
  it("puts what's waiting on the person first, then newest first", () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day));
    const actions = [
      { id: "queued-old", status: "queued" as const, createdAt: at(1) },
      { id: "working", status: "in_progress" as const, createdAt: at(2) },
      { id: "queued-new", status: "queued" as const, createdAt: at(5) },
      { id: "waiting", status: "waiting_on_user" as const, createdAt: at(1) },
    ];
    expect(orderInProgress(actions).map((a) => a.id)).toEqual([
      "waiting",
      "working",
      "queued-new",
      "queued-old",
    ]);
    // The input is left as it was.
    expect(actions[0].id).toBe("queued-old");
  });
});
