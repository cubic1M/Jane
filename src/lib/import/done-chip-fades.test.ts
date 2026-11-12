import { describe, expect, it, vi } from "vitest";

const { log, m } = vi.hoisted(() => {
  const calls = [] as string[];
  const log = (name: string, value: unknown = undefined) =>
    vi.fn(async () => {
      calls.push(name);
      return value;
    });
  return { calls, log, m: {} as Record<string, ReturnType<typeof vi.fn>> };
});

vi.mock("@/categorize/card-payments", () => ({ matchCardPayments: (m.match = log("match", 0)) }));
vi.mock("@/categorize/cash-income", () => ({ markCashIncome: log("cash income", 0) }));
vi.mock("@/categorize/categorize", () => ({
  categorizeLeftovers: (m.leftovers = log("leftovers", 0)),
}));
vi.mock("@/detection/engine", () => ({
  runDetection: (m.detect = log("detect")),
  moneyFoundYearly: (m.found = log("found", 36000)),
}));
vi.mock("@/lib/import/balances", () => ({
  rebuildUploadedBalances: (m.balances = log("balances", 4)),
}));
vi.mock("@/lib/suggestions", () => ({ scanSuggestions: log("suggestions") }));
vi.mock("@/lib/agent/switch", () => ({ confirmSwitches: log("switches") }));
vi.mock("@/lib/insurance/switch", () => ({ confirmInsuranceSwitches: log("insurance switches") }));
vi.mock("@/lib/insurance/daily", () => ({ insuranceAfterSync: log("insurance") }));
vi.mock("@/lib/deadlines", () => ({ remindDeadlines: log("deadlines") }));
vi.mock("@/lib/snapshots", () => ({ takeSnapshots: log("today's snapshot") }));
vi.mock("@/lib/scan", () => ({ markScanDone: log("scan done") }));
vi.mock("@/lib/jane-agent/run", () => ({
  keepFullSnapshot: log("chat snapshot"),
  runJaneAgentSafely: log("jane"),
}));
vi.mock("@/lib/jane-agent/claude-tools", () => ({ refreshPrimer: log("primer") }));
vi.mock("@/lib/jobs", () => ({
  enqueueJob: vi.fn(async () => "job_9"),
  runJob: log("card text"),
}));
const { updateMany, findFirst } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({ userId: "u1", importRuns: { updateMany, findFirst } })),
}));

import { currentImportRun } from "./background";

// Debugger 11-12: a student's upload finished, Jane's cards showed what it found, and the chip
// "Done: 29 transactions read · See findings" still followed them to every page an hour later,
// because it only went on /report or by its x. A finished upload's chip goes a few minutes after
// it's done; one still running keeps its day.

const NOW = new Date("2026-11-12T10:00:00Z");
const run = (stage: string, minutesAgo: number) => ({
  id: "r1",
  kind: "upload",
  rows: 29,
  stage,
  foundCents: null,
  seenAt: null,
  updatedAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000),
});

describe("a finished upload's chip", () => {
  it("shows for a few minutes after the upload is done", async () => {
    findFirst.mockResolvedValue(run("done", 3));
    expect(await currentImportRun("u1", { now: NOW })).toMatchObject({ id: "r1", stage: "done" });
  });

  it("is gone an hour after the upload is done, without a visit to /report", async () => {
    findFirst.mockResolvedValue(run("done", 60));
    expect(await currentImportRun("u1", { now: NOW })).toBeNull();
  });

  it("keeps showing an upload that's still running, however long it has taken", async () => {
    findFirst.mockResolvedValue(run("looking", 60));
    expect(await currentImportRun("u1", { now: NOW })).toMatchObject({ stage: "looking" });
  });

  it("never hands the chip its timestamps", async () => {
    findFirst.mockResolvedValue(run("done", 1));
    const shown = await currentImportRun("u1", { now: NOW });
    expect(shown).not.toHaveProperty("updatedAt");
    expect(shown).not.toHaveProperty("seenAt");
  });
});
