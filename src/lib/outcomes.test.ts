import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { expectedWhy } from "./outcomes";

// /saved's line under an expected saving (QA round 11): a bare yes isn't "You did it".
describe("why an expected saving isn't counted yet", () => {
  it("says the person said yes until they mark it done", () => {
    expect(expectedWhy({ status: "open", actedOn: "2026-10-24", markedDone: false })).toBe(
      "You said yes on 2026-10-24. It counts once your transactions show it.",
    );
    expect(expectedWhy({ status: "open", actedOn: "2026-10-24", markedDone: true })).toBe(
      "You did it on 2026-10-24. It counts once your transactions show it.",
    );
  });

  it("says when transactions can't show it", () => {
    expect(expectedWhy({ status: "unverifiable", actedOn: null, markedDone: false })).toBe(
      "You said yes; it isn't something your transactions can show.",
    );
  });
});
