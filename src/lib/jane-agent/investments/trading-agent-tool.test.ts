import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));
vi.mock("@/lib/trading-agent/agent", () => ({ loadAgentView: vi.fn() }));

import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadAgentView } from "@/lib/trading-agent/agent";
import { INVESTMENT_TOOL_STATUS, INVESTMENT_TOOLS, runInvestmentTool } from "./tools";

// The chat's view of the 24-hour agent: what it runs and its latest trades with fees and reasons,
// every replayed strategy's verdict, and nothing for a real account.

const client = {
  paperAccount: { findUnique: vi.fn(async () => ({ id: "p1" })) },
} as unknown as PrismaClient;
const now = new Date("2026-10-26T12:00:00Z");

describe("trading_agent", () => {
  it("is a tool with a status line, never called a forecast", () => {
    const tool = INVESTMENT_TOOLS.find((t) => t.name === "trading_agent")!;
    expect(tool.description).toMatch(/never a forecast/);
    expect(INVESTMENT_TOOL_STATUS.trading_agent).toBeTruthy();
  });

  it("gives the agent's trades with their fees and reasons, and records the dollars", async () => {
    vi.mocked(adviceMode).mockResolvedValue(true);
    vi.mocked(loadAgentView).mockResolvedValue({
      policy: "catalog:vol_target@BTC/USD",
      label: "Volatility targeting on BTC",
      interval: "1h",
      intervalLabel: "1 hour",
      market: "crypto",
      marketLabel: "Bitcoin and ether, around the clock",
      startedAt: now.toISOString(),
      lastBarAt: "2026-10-26T10:00:00.000Z",
      prices: "sample",
      evidence: null,
      trades: [
        {
          id: "t1",
          at: "2026-10-26T09:00:00.000Z",
          ticker: "BTC/USD",
          side: "buy",
          quantity: 0.01,
          priceCents: 9_000_000,
          amountCents: 90_000,
          feeCents: 225,
          spreadCents: 27,
          reason: "Volatility targeting on BTC: BTC/USD to 40% of the account.",
          source: "agent",
        },
      ],
    });
    const out = await runInvestmentTool("u1", "trading_agent", {}, { client, now });
    const body = JSON.parse(out.content);
    expect(body.simulatedOnly).toMatch(/nothing real/);
    expect(body.agent.latestTrades[0]).toMatchObject({
      trade: "buy BTC/USD",
      amount: "$900.00",
      fees: "$2.52",
      why: "Volatility targeting on BTC: BTC/USD to 40% of the account.",
    });
    expect(out.cents).toEqual(expect.arrayContaining([90_000, 9_000_000, 252]));
    expect(Array.isArray(body.replay)).toBe(true);
  });

  it("says nothing about it to a real account", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    const out = await runInvestmentTool("u1", "trading_agent", {}, { client, now });
    expect(Object.keys(JSON.parse(out.content))).toEqual(["note"]);
  });
});
