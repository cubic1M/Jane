import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/action-emails", () => ({ sendStatusEmail: vi.fn() }));
vi.mock("./run", () => ({}));

import { switchOf, switchTodo } from "./switch";

const OPTIONS = {
  switchTo: "opt_1",
  switchKind: "plan",
  switchName: "Pine Unlimited",
  switchProvider: "Pine Mobile",
  switchMonthlyCents: 3_500,
  switchSavingCents: 132_000,
  switchFromMonthlyCents: 14_500,
  switchSignUpUrl: "https://pine.example/join",
};

describe("switches", () => {
  it("reads the switch recorded with a yes", () => {
    expect(switchOf(OPTIONS)).toMatchObject({
      optionId: "opt_1",
      kind: "plan",
      provider: "Pine Mobile",
      monthlyCents: 3_500,
      fromMonthlyCents: 14_500,
      apyBps: null,
    });
    expect(switchOf({ targetMonthly: 5_000 })).toBeNull();
    expect(switchOf({ ...OPTIONS, switchKind: "insurance" })).toBeNull();
    expect(switchOf(null)).toBeNull();
  });

  it("tells the person the one thing to do, and that Jane does the rest", () => {
    const plan = switchTodo(switchOf(OPTIONS)!, "Verizon Wireless");
    expect(plan).toContain("Sign up for Pine Unlimited with the link");
    expect(plan).toContain("cancels Verizon Wireless for you");
    expect(switchTodo(switchOf({ ...OPTIONS, switchKind: "tier" })!, "Netflix")).toContain(
      "Change your Netflix plan",
    );
    const savings = switchTodo(switchOf({ ...OPTIONS, switchKind: "savings" })!, "the bank");
    expect(savings).toContain("Jane never moves money");
  });
});
