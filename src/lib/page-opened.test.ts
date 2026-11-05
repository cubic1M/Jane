import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/checklist", () => ({
  firstWeekChecklist: vi.fn(),
  recordChecklistProgress: vi.fn(async () => undefined),
}));
vi.mock("@/lib/events/refresh", () => ({ refreshEventsIfStale: vi.fn(async () => null) }));
vi.mock("@/lib/events/run", () => ({ runEventsIfStale: vi.fn(async () => undefined) }));
vi.mock("@/lib/paper/account", () => ({ runPaperIfStale: vi.fn(async () => undefined) }));
vi.mock("@/lib/plan", () => ({ markPlanShown: vi.fn(async () => undefined) }));
vi.mock("@/lib/practice/scan", () => ({ scanOnOpenQuietly: vi.fn(async () => undefined) }));

import { firstWeekChecklist, recordChecklistProgress } from "@/lib/checklist";
import { runEventsIfStale } from "@/lib/events/run";
import { runPaperIfStale } from "@/lib/paper/account";
import { markPlanShown } from "@/lib/plan";
import { scanOnOpenQuietly } from "@/lib/practice/scan";
import { pageOpened } from "./page-opened";

describe("what opening a page sets off", () => {
  beforeEach(() => {
    vi.mocked(firstWeekChecklist).mockReset().mockResolvedValue(null);
    vi.mocked(recordChecklistProgress).mockClear();
    vi.mocked(scanOnOpenQuietly).mockClear();
    vi.mocked(runPaperIfStale)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.mocked(runEventsIfStale)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.mocked(markPlanShown).mockClear();
  });

  it("Home: the scan, and the checklist's progress when something's newly done", async () => {
    await pageOpened("user_1", "home");
    expect(scanOnOpenQuietly).toHaveBeenCalledWith("user_1");
    expect(recordChecklistProgress).not.toHaveBeenCalled();

    const checklist = { newlyDone: ["budget"] } as never;
    vi.mocked(firstWeekChecklist).mockResolvedValue(checklist);
    await pageOpened("user_1", "home");
    expect(recordChecklistProgress).toHaveBeenCalledWith("user_1", checklist);
    expect(runPaperIfStale).not.toHaveBeenCalled();
  });

  it("Investments: the scan, the paper account and the events", async () => {
    await pageOpened("user_1", "investments");
    expect(scanOnOpenQuietly).toHaveBeenCalledWith("user_1");
    expect(runPaperIfStale).toHaveBeenCalledWith("user_1");
    expect(runEventsIfStale).toHaveBeenCalledWith("user_1", { news: false });
  });

  it("Investments: one failing doesn't stop the other, and is still reported", async () => {
    vi.mocked(runPaperIfStale).mockRejectedValue(new Error("no"));
    await expect(pageOpened("user_1", "investments")).rejects.toThrow("no");
    expect(runEventsIfStale).toHaveBeenCalled();
  });

  it("The plan: marks its cards shown, only then, and scans nothing", async () => {
    await pageOpened("user_1", "plan", ["abc"]);
    expect(markPlanShown).toHaveBeenCalledWith("user_1", ["abc"]);
    expect(scanOnOpenQuietly).not.toHaveBeenCalled();
  });
});
