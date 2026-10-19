import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { loadDebts } from "@/lib/debts";
import { formatCents } from "@/lib/money";
import { loadPayoff } from "@/lib/debt-plan";
import { DEBT_TOOLS, debtsToolOutput, extraFromInput, payoffToolOutput } from "./debt-tools";

// Runs Claude's debt tools (./debt-tools.ts) for one person: read-only, scoped to them,
// every dollar figure recorded for the guardrails, like ./claude-tools.ts runChatTool.

export const isDebtTool = (name: string) => DEBT_TOOLS.some((t) => t.name === name);

export async function runDebtTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ToolOutput> {
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return value < 0 ? `-${formatCents(-value)}` : formatCents(value);
  };
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });
  switch (name) {
    case "debts":
      return out(debtsToolOutput(await loadDebts(userId, { client, now }), money));
    case "payoff_plan": {
      const payoff = await loadPayoff(userId, { client, now, extraCents: extraFromInput(input) });
      return out(payoffToolOutput(payoff, now.toISOString().slice(0, 10), money));
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
