import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: {
    userId: "user_1",
    accounts: { findMany: vi.fn() },
    transactions: { findMany: vi.fn() },
    recurringStreams: { findMany: vi.fn() },
    findings: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    subscriptionChecks: { findMany: vi.fn(), createMany: vi.fn() },
    actions: { findMany: vi.fn(async () => []) },
    budgets: {
      findMany: vi.fn(async (): Promise<{ category: string; amountCents: number }[]> => []),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => scoped) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/alerts", () => ({ raiseAlerts: vi.fn() }));

import { REFUND_FINDING_TYPES } from "@/config/detection";
import type { PrismaClient } from "@/generated/prisma/client";
import { raiseAlerts } from "@/lib/alerts";
import { track } from "@/lib/analytics";
import { CHECKING, NETFLIX, monthly } from "./__fixtures__/build";
import {
  isFirstDetectionComplete,
  planChanges,
  runDetection,
  sumMoneyFound,
  type ExistingFinding,
} from "./engine";
import type { Candidate } from "./types";

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  type: "bank_fees",
  key: "account:acct_checking",
  title: "$49.00 in fees on Everyday Checking in the last 12 months",
  annualSavingsCents: 4900,
  amountCents: 4900,
  confidence: "high",
  evidence: { accountId: "acct_checking", totalCents: 4900 },
  ...overrides,
});

const existing = (overrides: Partial<ExistingFinding> = {}): ExistingFinding => {
  const c = candidate();
  return {
    id: "finding_1",
    type: c.type,
    key: c.key,
    title: c.title,
    annualSavingsCents: c.annualSavingsCents,
    amountCents: c.amountCents,
    confidence: c.confidence,
    evidence: c.evidence,
    status: "new",
    ...overrides,
  };
};

describe("planChanges", () => {
  it("creates findings it hasn't seen", () => {
    const plan = planChanges([], [candidate()]);

    expect(plan.create).toEqual([candidate()]);
    expect(plan.update).toEqual([]);
  });

  it("leaves an identical finding alone, even with evidence keys in another order", () => {
    const stored = existing({ evidence: { totalCents: 4900, accountId: "acct_checking" } });

    expect(planChanges([stored], [candidate()])).toEqual({
      create: [],
      update: [],
      remove: [],
      unchanged: 1,
      stillDeclined: 0,
    });
  });

  it("updates a changed finding in place and keeps its status", () => {
    const changed = candidate({ annualSavingsCents: 8300, amountCents: 8300 });

    const plan = planChanges([existing({ status: "shown" })], [changed]);

    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([{ id: "finding_1", candidate: changed, resurface: false }]);
  });

  it("matches on type and key, so the same key under another type is a new finding", () => {
    const plan = planChanges([existing()], [candidate({ type: "card_interest" })]);

    expect(plan.create).toHaveLength(1);
  });

  it("never touches a declined finding whose amount moved 20% or less", () => {
    const plan = planChanges(
      [existing({ status: "declined" })],
      [candidate({ amountCents: 5880, annualSavingsCents: 5880 })],
    );

    expect(plan.update).toEqual([]);
    expect(plan.stillDeclined).toBe(1);
  });

  it("brings back a declined finding whose amount moved more than 20%", () => {
    const bigger = candidate({ amountCents: 5881, annualSavingsCents: 5881 });

    const plan = planChanges([existing({ status: "declined" })], [bigger]);

    expect(plan.update).toEqual([{ id: "finding_1", candidate: bigger, resurface: true }]);
  });

  it("removes undecided findings a scan no longer produces and keeps decided ones", () => {
    const plan = planChanges(
      [
        existing({ id: "gone_new", status: "new" }),
        existing({ id: "gone_shown", key: "account:other", status: "shown" }),
        existing({ id: "kept_declined", key: "account:a", status: "declined" }),
        existing({ id: "kept_approved", key: "account:b", status: "approved" }),
        existing({ id: "kept_done", key: "account:c", status: "done" }),
      ],
      [],
    );

    expect(plan.remove).toEqual(["gone_new", "gone_shown"]);
  });

  it("keeps a declined finding declined when there's no amount to compare", () => {
    const plan = planChanges(
      [existing({ status: "declined", amountCents: null })],
      [candidate({ amountCents: 99999 })],
    );

    expect(plan.stillDeclined).toBe(1);
  });
});

describe("sumMoneyFound", () => {
  const row = (overrides: Partial<Parameters<typeof sumMoneyFound>[0][number]> = {}) => ({
    type: "bank_fees" as const,
    status: "new" as const,
    confidence: "high" as const,
    annualSavingsCents: 1000,
    ...overrides,
  });

  it("counts refunds only at medium confidence or above", () => {
    for (const type of REFUND_FINDING_TYPES) {
      expect(
        sumMoneyFound([
          row({ type, confidence: "medium", annualSavingsCents: 4_999 }),
          row({ type, confidence: "high", annualSavingsCents: 1_000 }),
          row({ type, confidence: "low", annualSavingsCents: 99_999 }),
        ]),
        type,
      ).toBe(5_999);
    }
  });

  it("adds open findings at medium confidence or above", () => {
    expect(
      sumMoneyFound([
        row(),
        row({ confidence: "medium", status: "shown" }),
        row({ confidence: "low" }),
      ]),
    ).toBe(2000);
  });

  it("skips findings without a dollar estimate or that are closed", () => {
    expect(
      sumMoneyFound([
        row({ type: "insurance_reshop", annualSavingsCents: null }),
        row({ status: "declined" }),
        row({ status: "done" }),
        row({ status: "failed" }),
      ]),
    ).toBe(0);
  });

  it("counts a subscription only once the person has approved cancelling it", () => {
    expect(
      sumMoneyFound([
        row({ type: "subscription_review", status: "new" }),
        row({ type: "subscription_review", status: "approved" }),
        row({ type: "subscription_review", status: "in_progress" }),
      ]),
    ).toBe(2000);
  });
});

describe("runDetection", () => {
  const updateMany = vi.fn();
  const client = {
    user: { updateMany },
    merchant: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const now = new Date("2026-10-15T18:30:00Z");

  beforeEach(() => {
    scoped.accounts.findMany.mockResolvedValue([{ ...CHECKING, currentBalanceCents: null }]);
    scoped.transactions.findMany.mockResolvedValue(
      monthly(4, 1549, NETFLIX).map((t) => ({ ...t, date: new Date(`${t.date}T00:00:00Z`) })),
    );
    scoped.recurringStreams.findMany.mockResolvedValue([]);
    scoped.findings.findMany.mockReset().mockResolvedValue([]);
    scoped.findings.createMany.mockReset().mockResolvedValue({ count: 1 });
    scoped.findings.update.mockReset();
    scoped.findings.deleteMany.mockReset();
    scoped.subscriptionChecks.findMany.mockReset().mockResolvedValue([]);
    scoped.subscriptionChecks.createMany.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(raiseAlerts).mockReset().mockResolvedValue({ raised: 0, emailed: 0 });
    vi.mocked(track).mockReset();
  });

  it("loads the lookback window, saves new findings and reports what it found", async () => {
    const summary = await runDetection("user_1", { client, now });

    expect(scoped.transactions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pending: false,
          date: {
            gt: new Date("2025-10-15T00:00:00Z"),
            lte: new Date("2026-10-15T00:00:00Z"),
          },
        },
      }),
    );
    const { data, skipDuplicates } = scoped.findings.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toEqual([
      expect.objectContaining({
        userId: "user_1",
        type: "subscription_review",
        key: "merchant:netflix",
        annualSavingsCents: 18588,
      }),
    ]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "user_1", firstDetectionAt: null },
      data: { firstDetectionAt: now },
    });
    expect(summary).toMatchObject({ created: 1, updated: 0, resurfaced: 0 });
    expect(summary.counts.subscription_review).toBe(1);
    expect(track).toHaveBeenCalledWith(
      "user_1",
      "detection_completed",
      expect.objectContaining({
        subscription_review: 1,
        bank_fees: 0,
        created: 1,
        money_found_cents: expect.any(Number),
      }),
    );
  });

  it("writes nothing to findings when a rerun finds the same thing", async () => {
    await runDetection("user_1", { client, now });
    const created = scoped.findings.createMany.mock.calls[0][0].data[0];
    scoped.findings.findMany.mockResolvedValue([{ id: "finding_1", status: "new", ...created }]);
    scoped.findings.createMany.mockClear();

    const summary = await runDetection("user_1", { client, now });

    expect(scoped.findings.createMany).not.toHaveBeenCalled();
    expect(scoped.findings.update).not.toHaveBeenCalled();
    expect(scoped.findings.deleteMany).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ created: 0, updated: 0 });
  });

  it("sets a resurfaced finding back to new", async () => {
    scoped.findings.findMany.mockResolvedValue([
      {
        id: "finding_9",
        type: "subscription_review",
        key: "merchant:netflix",
        title: "old",
        annualSavingsCents: 9000,
        amountCents: 9000,
        confidence: "medium",
        evidence: {},
        status: "declined",
      },
    ]);

    const summary = await runDetection("user_1", { client, now });

    expect(scoped.findings.update).toHaveBeenCalledWith({
      where: { id: "finding_9" },
      data: expect.objectContaining({ status: "new", amountCents: 18588 }),
    });
    expect(summary.resurfaced).toBe(1);
  });

  it("deletes only undecided findings that are no longer detected", async () => {
    scoped.findings.findMany.mockResolvedValue([
      { id: "stale", type: "bank_fees", key: "account:x", status: "shown", evidence: {} },
    ]);

    const summary = await runDetection("user_1", { client, now });

    expect(scoped.findings.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["stale"] }, status: { in: ["new", "shown"] } },
    });
    expect(summary.removed).toBe(1);
  });

  it("raises this scan's alerts, telling the rules what was already known", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    scoped.findings.findMany.mockResolvedValue([
      { id: "f1", type: "bank_fees", key: "account:x", status: "shown", evidence: {} },
    ]);

    await runDetection("user_1", { client, now });

    expect(raiseAlerts).toHaveBeenCalledWith("user_1", expect.any(Array), { client, now });
    // Netflix's subscription finding is new on a later scan, and charged this month.
    const [, alerts] = vi.mocked(raiseAlerts).mock.calls[0];
    expect(alerts).toEqual([
      expect.objectContaining({ type: "new_subscription", key: "merchant:netflix" }),
    ]);
  });

  it("raises an over-budget alert from the person's budgets", async () => {
    scoped.budgets.findMany.mockResolvedValueOnce([
      { category: "Entertainment", amountCents: 1_000 },
    ]);

    await runDetection("user_1", { client, now });

    expect(vi.mocked(raiseAlerts).mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "over_budget", key: "Entertainment:2026-10" }),
      ]),
    );
  });

  it("raises no new-subscription alerts on the first scan", async () => {
    await runDetection("user_1", { client, now });
    expect(vi.mocked(raiseAlerts).mock.calls[0][1]).toEqual([]);
  });

  it("still finishes the scan when alerts fail", async () => {
    vi.mocked(raiseAlerts).mockRejectedValue(new Error("database is down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = await runDetection("user_1", { client, now });

    expect(summary.created).toBe(1);
    expect(error).toHaveBeenCalledWith("Alerts failed", expect.any(Object));
    error.mockRestore();
  });
});

describe("runDetection asking Claude about unclear merchants", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const updateMany = vi.fn();
  const client = {
    user: { updateMany },
    merchant: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const CANVA = {
    description: "CANVA* PRO MONTHLY",
    pfcPrimary: "GENERAL_SERVICES",
    pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
  };

  beforeEach(() => {
    scoped.accounts.findMany.mockResolvedValue([{ ...CHECKING, currentBalanceCents: null }]);
    scoped.transactions.findMany.mockResolvedValue(
      monthly(4, 1499, CANVA).map((t) => ({ ...t, date: new Date(`${t.date}T00:00:00Z`) })),
    );
    scoped.recurringStreams.findMany.mockResolvedValue([]);
    scoped.findings.findMany.mockReset().mockResolvedValue([]);
    scoped.findings.createMany.mockReset().mockResolvedValue({ count: 1 });
    scoped.subscriptionChecks.findMany.mockReset().mockResolvedValue([]);
    scoped.subscriptionChecks.createMany.mockReset();
    vi.stubEnv("ANTHROPIC_MODEL", "claude-test-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks once, saves the answer and lets the rule use it", async () => {
    const check = vi.fn().mockResolvedValue(new Map([["Canva", true]]));

    const summary = await runDetection("user_1", { client, now, checkSubscriptions: check });

    expect(check).toHaveBeenCalledWith(["Canva"]);
    expect(scoped.subscriptionChecks.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user_1",
          merchantKey: "canva",
          isSubscription: true,
          model: "claude-test-model",
          promptVersion: "subscription-v1",
        },
      ],
      skipDuplicates: true,
    });
    expect(summary.counts.subscription_review).toBe(1);
  });

  it("never asks again about a merchant it has an answer for", async () => {
    scoped.subscriptionChecks.findMany.mockResolvedValue([
      { merchantKey: "canva", isSubscription: false },
    ]);
    const check = vi.fn();

    const summary = await runDetection("user_1", { client, now, checkSubscriptions: check });

    expect(check).not.toHaveBeenCalled();
    expect(summary.counts.subscription_review).toBe(0);
  });

  it("finds no subscription when Claude can't be asked", async () => {
    const check = vi.fn().mockResolvedValue(new Map());

    const summary = await runDetection("user_1", { client, now, checkSubscriptions: check });

    expect(scoped.subscriptionChecks.createMany).not.toHaveBeenCalled();
    expect(summary.counts.subscription_review).toBe(0);
  });
});

describe("isFirstDetectionComplete", () => {
  it("reads the user's first detection time", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ firstDetectionAt: new Date() });
    findUnique.mockResolvedValueOnce({ firstDetectionAt: null });
    const client = { user: { findUnique } } as unknown as PrismaClient;

    expect(await isFirstDetectionComplete("user_1", { client })).toBe(true);
    expect(await isFirstDetectionComplete("user_1", { client })).toBe(false);
  });
});
