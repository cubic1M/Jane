import { describe, expect, it } from "vitest";
import type { ScanProgress } from "@/lib/scan";
import { monthsLabel, percentFor, slowLink, STAGES, stagesDone } from "./stages";

const none: ScanProgress = {
  accounts: false,
  months: 0,
  transactions: false,
  detection: false,
  suggestions: false,
  done: false,
};

describe("the scan's stages", () => {
  it("counts stages in order, from what has really finished", () => {
    expect(stagesDone(null)).toBe(0);
    expect(stagesDone(none)).toBe(0);
    expect(stagesDone({ ...none, accounts: true })).toBe(1);
    expect(stagesDone({ ...none, accounts: true, transactions: true })).toBe(2);
    // A later stage done doesn't skip an earlier one that isn't.
    expect(stagesDone({ ...none, detection: true })).toBe(0);
    expect(
      stagesDone({
        accounts: true,
        months: 12,
        transactions: true,
        detection: true,
        suggestions: true,
        done: true,
      }),
    ).toBe(STAGES.length);
  });

  it("names the months it read", () => {
    expect(monthsLabel(12)).toBe("Reading 12 months of transactions");
    expect(monthsLabel(1)).toBe("Reading 1 month of transactions");
    expect(monthsLabel(0)).toBe("Reading your transactions");
  });

  it("only goes forward, and creeps toward the next stage without reaching it", () => {
    let last = -1;
    for (let done = 0; done <= STAGES.length; done += 1) {
      for (const creep of [0, 0.3, 1, 5]) {
        const p = percentFor(done, creep);
        if (creep === 0) expect(p).toBeGreaterThanOrEqual(last);
        if (done < STAGES.length && creep > 0) expect(p).toBeLessThan(STAGES[done].percent);
      }
      last = percentFor(done, 1);
    }
    expect(percentFor(0, 0)).toBe(0);
    expect(percentFor(STAGES.length, 0)).toBe(100);
  });
});

describe("a slow scan", () => {
  it("offers where the screen was heading: the chat from Try Jane, else the report", () => {
    expect(slowLink("/chat")).toMatchObject({ href: "/chat", label: "Open the chat" });
    expect(slowLink("/report")).toMatchObject({ href: "/report", label: "See your report" });
  });
});
