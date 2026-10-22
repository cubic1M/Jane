import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));

import { formatReturn } from "@/insights/returns";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadBacktests } from "@/lib/investments/backtest";
import { formatCents } from "@/lib/money";
import { CHAT_TOOLS, runChatTool } from "./claude-tools";
import { lookupsFor, sectorsFor, toolsFor } from "./tool-select";

// Spec step 295: "how would a High portfolio have done in 2022" is answered from the same
// numbers as the investments page, in demo advice mode only, with every figure recorded.

const NOW = new Date("2026-10-21T15:00:00Z");
// No stored history: the sample market.
const client = { marketPrice: { findMany: async () => [] } } as unknown as PrismaClient;
const QUESTION = "how would a High portfolio have done in 2022";

describe("backtest_by_level", () => {
  it("answers a level and a year from the page's numbers", async () => {
    vi.mocked(adviceMode).mockResolvedValue(true);
    const out = await runChatTool(
      "u1",
      "backtest_by_level",
      { level: "High", year: 2022 },
      { client, now: NOW },
    );
    const body = JSON.parse(out.content);
    const page = (await loadBacktests({ client, now: NOW })).levels.find((l) => l.level === 4)!;
    const y2022 = page.result.years.find((y) => y.year === 2022)!;

    expect(body.replay).toBe("Replay of sample history since Jan 2, 2018");
    expect(body.notAForecast).toMatch(/not a forecast/);
    expect(body.assumptions.taxes).toBe("none (base case)");
    expect(body.levels).toHaveLength(1);
    const high = body.levels[0];
    expect(high.level).toBe("High");
    expect(high.stocksPercent).toBe(75);
    expect(high.endValue).toBe(formatCents(page.result.endCents));
    expect(high.worstDrop.fall).toBe(formatReturn(page.result.worstDrop.fraction));
    expect(high.inYear).toEqual({
      year: 2022,
      startValue: formatCents(y2022.startCents),
      endValue: formatCents(y2022.endCents),
      return: formatReturn(y2022.return),
      worstFallInTheYear: formatReturn(y2022.worstDrop),
    });
    // Every dollar figure is recorded for the guardrails.
    expect(out.cents).toEqual(
      expect.arrayContaining([page.result.endCents, y2022.startCents, y2022.endCents]),
    );
  });

  it("gives all five levels without a level, and says when a year isn't replayed", async () => {
    vi.mocked(adviceMode).mockResolvedValue(true);
    const out = await runChatTool("u1", "backtest_by_level", { year: 2010 }, { client, now: NOW });
    const body = JSON.parse(out.content);
    expect(body.levels.map((l: { level: string }) => l.level)).toEqual([
      "Very low",
      "Low",
      "Medium",
      "High",
      "Very high",
    ]);
    expect(body.levels[0].inYear).toEqual({ year: 2010, note: "That year isn't in the replay." });
  });

  it("gives no figures for a real account", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    const out = await runChatTool("u1", "backtest_by_level", {}, { client, now: NOW });
    expect(JSON.parse(out.content)).toEqual({ note: expect.stringMatching(/demo advice/) });
    expect(out.cents).toEqual([]);
  });

  it("is sent, and looked up first, for the question", () => {
    const tool = CHAT_TOOLS.find((t) => t.name === "backtest_by_level")!;
    expect((tool.input_schema as { required?: string[] }).required ?? []).toEqual([]);
    expect(tool.description).toMatch(/never a forecast/);
    const asOf = "2026-10-21";
    expect(toolsFor(CHAT_TOOLS, QUESTION, null, null, asOf).map((t) => t.name)).toContain(
      "backtest_by_level",
    );
    expect(lookupsFor(QUESTION, sectorsFor(QUESTION, null, null, asOf))).toContain(
      "backtest_by_level",
    );
    expect(
      toolsFor(CHAT_TOOLS, "how am I doing", null, null, asOf).map((t) => t.name),
    ).not.toContain("backtest_by_level");
  });
});
