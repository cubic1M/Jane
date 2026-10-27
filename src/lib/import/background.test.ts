import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, log, m } = vi.hoisted(() => {
  const calls = [] as string[];
  const log = (name: string, value: unknown = undefined) =>
    vi.fn(async () => {
      calls.push(name);
      return value;
    });
  return { calls, log, m: {} as Record<string, ReturnType<typeof vi.fn>> };
});

vi.mock("@/categorize/card-payments", () => ({ matchCardPayments: (m.match = log("match", 0)) }));
vi.mock("@/categorize/categorize", () => ({
  categorizeLeftovers: (m.leftovers = log("leftovers", 0)),
}));
vi.mock("@/detection/engine", () => ({
  runDetection: (m.detect = log("detect")),
  moneyFound: (m.found = log("found", 36000)),
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

import { currentImportRun, dismissImportRun, finishImport } from "./background";

beforeEach(() => {
  calls.length = 0;
  m.leftovers.mockImplementation(async () => {
    calls.push("leftovers");
    return 0;
  });
  m.detect.mockImplementation(async () => {
    calls.push("detect");
  });
  updateMany.mockReset().mockImplementation(async ({ data }: { data: { stage?: string } }) => {
    if (data.stage) calls.push(`stage:${data.stage}`);
    return { count: 1 };
  });
});

describe("finishImport", () => {
  it("goes through each stage in order, refreshes every sector, then says done", async () => {
    await finishImport("u1", "run_1");
    const done = calls.indexOf("stage:done");
    expect(calls.slice(0, 7)).toEqual([
      "stage:matching",
      "match",
      "stage:balances",
      "balances",
      "stage:looking",
      "detect",
      "stage:refreshing",
    ]);
    for (const step of [
      "suggestions",
      "switches",
      "insurance switches",
      "insurance",
      "deadlines",
      "today's snapshot",
      "scan done",
    ]) {
      expect(calls.indexOf(step), step).toBeGreaterThan(calls.indexOf("stage:refreshing"));
      expect(calls.indexOf(step), step).toBeLessThan(done);
    }
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "run_1" },
      data: { stage: "done", foundCents: 36000 },
    });
    // After "done": Claude's pass, Jane's saved numbers, the card text and Jane's message.
    expect(calls.indexOf("leftovers")).toBeGreaterThan(done);
    expect(calls.indexOf("chat snapshot")).toBeGreaterThan(done);
    expect(calls.indexOf("primer")).toBeGreaterThan(done);
    expect(calls.indexOf("card text")).toBeGreaterThan(done);
    expect(calls.at(-1)).toBe("jane");
  });

  it("works everything out again when Claude sorted something", async () => {
    m.leftovers.mockImplementation(async () => {
      calls.push("leftovers");
      return 5;
    });
    await finishImport("u1", "run_1");
    const after = calls.slice(calls.indexOf("leftovers"));
    expect(after).toEqual(expect.arrayContaining(["match", "balances", "detect", "stage:done"]));
  });

  it("marks the upload failed and throws, so the job is retried", async () => {
    m.detect.mockRejectedValue(new Error("database down"));
    await expect(finishImport("u1", "run_1")).rejects.toThrow("database down");
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "run_1" },
      data: { stage: "failed" },
    });
  });
});

describe("the chip's view", () => {
  it("shows the latest upload not closed in the last day, with its share of the bar", async () => {
    findFirst.mockResolvedValue({
      id: "r1",
      kind: "upload",
      rows: 172,
      stage: "looking",
      foundCents: null,
    });
    const now = new Date("2026-10-27T12:00:00Z");
    expect(await currentImportRun("u1", { now })).toEqual({
      id: "r1",
      kind: "upload",
      rows: 172,
      stage: "looking",
      percent: 40,
      foundCents: null,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { seenAt: null, createdAt: { gte: new Date("2026-10-26T12:00:00Z") } },
        orderBy: { createdAt: "desc" },
      }),
    );
    findFirst.mockResolvedValue(null);
    expect(await currentImportRun("u1", { now })).toBeNull();
  });

  it("is closed for good once the person closes it", async () => {
    const now = new Date("2026-10-27T12:00:00Z");
    await dismissImportRun("u1", "r1", { now });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "r1" }, data: { seenAt: now } });
  });
});
