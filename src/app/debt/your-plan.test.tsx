import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Payoff } from "@/lib/debt-plan";

vi.mock("./actions", () => ({ startPlan: vi.fn(), stopPlan: vi.fn() }));
import { YourPlan } from "./your-plan";

const fail = { ok: false, reason: "never" };
const payoff = (stored: "snowball" | "avalanche" | null): Payoff =>
  ({
    advice: true,
    book: { debts: [] },
    debtFreeMonth: null,
    stored: stored && {
      strategy: stored,
      extraCents: 0,
      status: null,
      actualCents: null,
      expectedCents: null,
    },
    summary: {
      cards: [{}],
      leftOut: [],
      minimumsCents: 0,
      extraCents: 0,
      avalanche: fail,
      snowball: fail,
      baseline: fail,
      pick: { strategy: "avalanche", order: [], why: [] },
      scenarios: [],
      savedAgainst: "minimums",
    },
  }) as unknown as Payoff;

const html = (p: Payoff) =>
  renderToStaticMarkup(<YourPlan payoff={p} asOf="2026-11-01" saved="" error="" />);

describe("YourPlan: the saved plan", () => {
  it("is still the person's plan, with Stop, when they chose the other order than Jane's pick", () => {
    const out = html(payoff("snowball"));
    expect(out).toContain("This is your plan (smallest balance first)");
    expect(out).toContain("Stop the plan");
    expect(out).not.toContain("Start this plan");
  });

  it("shows the start buttons when there is no saved plan", () => {
    expect(html(payoff(null))).toContain("Start this plan");
  });
});
