import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { templateSummary, writeSummary, type CheckIn } from "./check-in";

const checkIn: CheckIn = {
  month: "2026-09",
  spendingCents: 34_000,
  incomeCents: 300_000,
  previousSpendingCents: 30_000,
  budgets: [{ category: "Food and drink", budgetCents: 20_000, spentCents: 25_000, kept: false }],
  changes: [],
  netWorth: { startCents: 100_000, endCents: 120_000 },
  found: { findings: 2, annualSavingsCents: 18_000 },
  savedCents: 6_000,
};

describe("templateSummary", () => {
  it("states the month plainly from the figures", () => {
    expect(templateSummary(checkIn)).toBe(
      "In September you spent $340.00, up $40.00 from the month before. You went over in Food and drink. Changes you finished save about $60.00 a year.",
    );
  });
});

describe("writeSummary", () => {
  const create = vi.fn();
  const claude = () => ({ messages: { create } }) as never;
  const reply = (summary: string) => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ summary }) }],
  });
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses Claude's summary when it only uses the month's figures", async () => {
    create.mockResolvedValue(reply("September came in at $340.00, a little more than August."));
    expect(await writeSummary(checkIn, { claude })).toEqual({
      text: "September came in at $340.00, a little more than August.",
      source: "llm",
    });
  });

  it("falls back to the template for an invented figure or advice", async () => {
    for (const text of ["You spent $999.00.", "Consider moving savings into an index fund."]) {
      create.mockResolvedValue(reply(text));
      expect(await writeSummary(checkIn, { claude })).toMatchObject({ source: "template" });
    }
  });

  it("uses the template without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await writeSummary(checkIn, { claude })).toMatchObject({ source: "template" });
    expect(create).not.toHaveBeenCalled();
  });
});
