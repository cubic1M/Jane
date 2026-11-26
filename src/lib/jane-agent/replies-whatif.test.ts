import { describe, expect, it } from "vitest";
import { runScenario, type WhatIfBaseline } from "@/planning/what-if";
import { whatIfReply } from "./replies-whatif";

// CodeRabbit part 2 (open O26): the what-if reply shows the cover lines. A real account gets what
// is true ("About cover"), never what to check; demo advice mode gets the advice, labelled.

const baseline: WhatIfBaseline = {
  cashCents: 1_200_000,
  monthlyIncomeCents: 600_000,
  monthlySpendingCents: 450_000,
  marginalRate: 0.22,
  goals: [],
  debt: { hasDebts: false, before: null, after: null },
};

describe("what-if reply cover lines", () => {
  it("a real account is told the facts and carries no advice mark", () => {
    const reply = whatIfReply(runScenario("job_loss", baseline, { months: 6 }));
    expect(reply.body).toContain(
      "About cover: Health, disability and life cover through work usually end with the job.",
    );
    expect(reply.body).not.toMatch(/COBRA|marketplace/);
    expect(reply.refs.advice).toBeUndefined();
  });

  it("demo advice mode gets what to check, marked as advice", () => {
    const reply = whatIfReply(runScenario("job_loss", baseline, { months: 6 }, { advice: true }));
    expect(reply.body).toContain("Cover to check: Health cover through work usually ends;");
    expect(reply.refs.advice).toBe(true);
  });

  it("says nothing about cover when there is nothing true to say", () => {
    const reply = whatIfReply(runScenario("raise", baseline));
    expect(reply.body).not.toMatch(/cover/i);
    expect(reply.refs.advice).toBeUndefined();
  });
});
