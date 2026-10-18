import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { computeMetrics, median, type MetricRows } from "./metrics";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));
const WINDOW = { start: day(0), end: day(30) };

const empty = (): MetricRows => ({
  users: [],
  links: [],
  findings: [],
  cardOpens: [],
  decisions: [],
  actions: [],
  membershipIntents: [],
  activity: [],
});

describe("computeMetrics", () => {
  it("link rate: sign-ups in the period who linked an account", () => {
    const rows = {
      ...empty(),
      users: [
        { id: "a", createdAt: day(1) },
        { id: "b", createdAt: day(2) },
        { id: "old", createdAt: day(-40) },
      ],
      links: [
        { userId: "a", linkedAt: day(1) },
        { userId: "old", linkedAt: day(-39) },
      ],
    };

    expect(computeMetrics(rows, WINDOW).linkRate).toEqual({ signedUp: 2, linked: 1, rate: 0.5 });
  });

  it("money found: median of each linked user's money-found total", () => {
    const finding = (userId: string, cents: number) => ({
      userId,
      type: "bank_fees" as const,
      status: "new" as const,
      confidence: "high" as const,
      annualSavingsCents: cents,
    });
    const rows = {
      ...empty(),
      links: ["a", "b", "c"].map((userId) => ({ userId, linkedAt: day(3) })),
      findings: [finding("a", 1000), finding("b", 5000), finding("b", 1000), finding("c", 3000)],
    };

    expect(computeMetrics(rows, WINDOW).moneyFound).toEqual({ users: 3, medianCents: 3000 });
  });

  it("approval rate per type: yes answers over cards opened", () => {
    const rows = {
      ...empty(),
      cardOpens: [
        { findingType: "bank_fees" as const, at: day(1) },
        { findingType: "bank_fees" as const, at: day(2) },
        { findingType: "idle_cash" as const, at: day(2) },
      ],
      decisions: [
        { findingType: "bank_fees" as const, choice: "yes" as const, at: day(2) },
        { findingType: "idle_cash" as const, choice: "no" as const, at: day(3) },
      ],
    };

    expect(computeMetrics(rows, WINDOW).approval).toEqual([
      { type: "bank_fees", shown: 2, approved: 1, rate: 0.5 },
      { type: "idle_cash", shown: 1, approved: 0, rate: 0 },
    ]);
  });

  it("completion, willingness to pay and minutes per action", () => {
    const action = (
      userId: string,
      status: "done" | "failed",
      completedAt: Date,
      minutesSpent: number,
    ) => ({
      userId,
      type: "cancel_subscription" as const,
      status,
      createdAt: day(0),
      completedAt,
      minutesSpent,
    });
    const rows = {
      ...empty(),
      actions: [
        action("a", "done", day(5), 10),
        action("b", "done", day(6), 20),
        action("c", "failed", day(7), 5),
      ],
      membershipIntents: [
        { userId: "a", at: day(8) },
        { userId: "b", at: day(1) }, // before their first completed action: doesn't count
      ],
    };

    const metrics = computeMetrics(rows, WINDOW);
    expect(metrics.completion).toEqual({ closed: 3, done: 2, rate: 2 / 3 });
    expect(metrics.willingnessToPay).toEqual({ completed: 2, willing: 1, rate: 0.5 });
    expect(metrics.minutes).toEqual([
      { type: "cancel_subscription", actions: 2, averageMinutes: 15 },
    ]);
  });

  it("30-day retention: back in days 23 to 30 after linking", () => {
    const rows = {
      ...empty(),
      links: [
        { userId: "back", linkedAt: day(-10) },
        { userId: "gone", linkedAt: day(-10) },
        { userId: "early", linkedAt: day(-10) },
        { userId: "too-new", linkedAt: day(10) },
      ],
      activity: [
        { userId: "back", at: day(15) },
        { userId: "early", at: day(1) },
      ],
    };

    expect(computeMetrics(rows, WINDOW).retention).toEqual({ cohort: 3, retained: 1, rate: 1 / 3 });
  });

  it("reports no rate rather than zero when there's nothing to measure", () => {
    expect(computeMetrics(empty(), WINDOW).linkRate.rate).toBeNull();
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
});
