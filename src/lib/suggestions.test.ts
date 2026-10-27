import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { stillChosen } from "./suggestions";

describe("stillChosen", () => {
  it("drops a same-day pick that no longer fires, and keeps the rest and ideas", () => {
    const chosen = [
      { key: "insurance:auto_insurance" },
      { key: "money:emergency_fund" },
      { key: "strategist:idea-1" },
    ];
    // A second upload showed the car insurance payments: that suggestion stopped firing.
    expect(stillChosen(chosen, new Set(["money:emergency_fund"]))).toEqual({
      keep: [{ key: "money:emergency_fund" }, { key: "strategist:idea-1" }],
      outdated: [{ key: "insurance:auto_insurance" }],
    });
  });

  it("keeps everything that still fires", () => {
    const chosen = [{ key: "a:b" }];
    expect(stillChosen(chosen, new Set(["a:b"]))).toEqual({ keep: chosen, outdated: [] });
  });
});
