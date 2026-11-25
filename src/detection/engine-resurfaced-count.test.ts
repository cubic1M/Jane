import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: {
    userId: "user_1",
    accounts: { findMany: vi.fn() },
    // The accounts counted (src/lib/account-copies.ts): no banks named, nothing said to be separate.
    plaidItems: { findMany: vi.fn(async () => []) },
    janePreferences: { findMany: vi.fn(async () => []) },
    transactions: {
      findMany: vi.fn(),
      // Where the data reaches (src/lib/data-reach.ts): nothing older, so it's today.
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _min: { date: null } })),
      groupBy: vi.fn(async () => []),
    },
    me: { findUnique: vi.fn(async () => ({ timezone: null })) },
    recurringStreams: { findMany: vi.fn() },
    balanceSnapshots: { groupBy: vi.fn(async () => []) },
    findings: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(),
    },
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
// What goes with a removed source is tested against a real database (src/lib/evidence).
vi.mock("@/lib/evidence/orphans", () => ({
  removeOrphans: vi.fn(async () => ({ findings: 0, outcomes: 0, alerts: 0 })),
}));
vi.mock("@/lib/alerts", () => ({ raiseAlerts: vi.fn() }));
// Spec step 208: what the person said is theirs, and refunds that never arrived (own tests).
vi.mock("@/lib/unusual", () => ({
  loadTaught: vi.fn(async () => new Map()),
  expectedFor: vi.fn(async () => new Set()),
  missingRefundAlerts: vi.fn(async () => []),
}));

import type { PrismaClient } from "@/generated/prisma/client";
import { raiseAlerts } from "@/lib/alerts";
import { track } from "@/lib/analytics";
import { CHECKING, NETFLIX, monthly } from "./__fixtures__/build";
import { runDetection } from "./engine";

// The summary and the detection_completed event count only the resurfacings that wrote.
describe("runDetection counts resurfacings by what was written", () => {
  const updateMany = vi.fn();
  const client = {
    user: { updateMany, findUnique: async () => ({ timezone: null }) },
    merchant: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const now = new Date("2026-10-15T18:30:00Z");
  const declined = {
    id: "finding_9",
    type: "subscription_review",
    key: "merchant:netflix",
    title: "old",
    annualSavingsCents: 9000,
    amountCents: 9000,
    confidence: "medium",
    evidence: {},
    status: "declined",
  };

  beforeEach(() => {
    scoped.accounts.findMany.mockResolvedValue([{ ...CHECKING, currentBalanceCents: null }]);
    scoped.transactions.findMany.mockResolvedValue(
      monthly(4, 1549, NETFLIX).map((t) => ({ ...t, date: new Date(`${t.date}T00:00:00Z`) })),
    );
    scoped.recurringStreams.findMany.mockResolvedValue([]);
    scoped.findings.findMany.mockReset().mockResolvedValue([declined]);
    scoped.findings.createMany.mockReset().mockResolvedValue({ count: 0 });
    scoped.findings.update.mockReset();
    scoped.findings.updateMany.mockReset();
    scoped.findings.deleteMany.mockReset();
    scoped.subscriptionChecks.findMany.mockReset().mockResolvedValue([]);
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(raiseAlerts).mockReset().mockResolvedValue({ raised: 0, emailed: 0 });
    vi.mocked(track).mockReset();
  });

  it("reports one when the declined finding was set back to new", async () => {
    scoped.findings.updateMany.mockResolvedValue({ count: 1 });
    const summary = await runDetection("user_1", { client, now });
    expect(summary.resurfaced).toBe(1);
  });

  it("reports none when the person approved it mid-scan and nothing was written", async () => {
    scoped.findings.updateMany.mockResolvedValue({ count: 0 });
    const summary = await runDetection("user_1", { client, now });
    expect(summary.resurfaced).toBe(0);
    expect(track).toHaveBeenCalledWith(
      "user_1",
      "detection_completed",
      expect.objectContaining({ resurfaced: 0 }),
    );
  });
});
