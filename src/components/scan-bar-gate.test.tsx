import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanInProgress, scanProgress } from "@/lib/scan";
import { ScanBarGate } from "./scan-bar-gate";

// A page reads its data, and only then does the header ask whether the first scan is running. If
// the scan ends between the two, no bar means nothing reads the page again, and it stays as it was
// mid-scan (/jane said "nothing right now" beside a dock full of cards, CI 11-25).

vi.mock("@/lib/scan", () => ({ scanInProgress: vi.fn(), scanProgress: vi.fn() }));
vi.mock("@/components/scan-bar-lazy", () => ({ ScanBarLazy: () => null }));

const done = {
  accounts: true,
  months: 12,
  transactions: true,
  detection: true,
  suggestions: true,
  done: true,
};

describe("the first scan's bar", () => {
  beforeEach(() => {
    vi.mocked(scanProgress).mockReset().mockResolvedValue(done);
    vi.mocked(scanInProgress).mockReset();
  });

  it("is drawn, already finished, when the scan ended after the page read its data", async () => {
    vi.mocked(scanInProgress).mockResolvedValue(false);
    const bar = await ScanBarGate({ userId: "u1", wasRunning: true });
    // Finished, so the bar reloads the page's data at once.
    expect(bar?.props).toEqual({ initial: done });
  });

  it("is not drawn on a page that read its data after the scan", async () => {
    vi.mocked(scanInProgress).mockResolvedValue(false);
    expect(await ScanBarGate({ userId: "u1" })).toBeNull();
    expect(await ScanBarGate({ userId: "u1", wasRunning: false })).toBeNull();
    expect(scanProgress).not.toHaveBeenCalled();
  });

  it("is drawn while the scan runs, as before", async () => {
    vi.mocked(scanInProgress).mockResolvedValue(true);
    vi.mocked(scanProgress).mockResolvedValue({ ...done, done: false });
    const bar = await ScanBarGate({ userId: "u1" });
    expect(bar?.props).toEqual({ initial: { ...done, done: false } });
  });
});
