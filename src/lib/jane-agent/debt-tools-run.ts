import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { loadDebts } from "@/lib/debts";
import { formatCents } from "@/lib/money";
import { loadPayoff } from "@/lib/debt-plan";
import { loadTransfers } from "@/lib/balance-transfers";
import { loadStudentLoans } from "@/lib/student-loans";
import { loadMortgage } from "@/lib/mortgage";
import { loadCredit } from "@/lib/credit";
import { loadDebtAutopilot } from "@/lib/debt-autopilot";
import { loadCreditCards } from "@/lib/credit-cards";
import { loadCreditBuilding } from "@/lib/credit-building";
import { loadBnpl } from "@/lib/bnpl";
import { loadTightMoney } from "@/lib/tight-money";
import { loadCar } from "@/lib/car";
import { listApplications } from "@/lib/loan-applications";
import { loadRefinance } from "@/lib/refinance";
import {
  DEBT_TOOLS,
  debtsToolOutput,
  extraFromInput,
  payoffToolOutput,
  refinanceToolOutput,
  applicationsToolOutput,
  transfersToolOutput,
  studentToolOutput,
  mortgageToolOutput,
  creditToolOutput,
  debtAutopilotToolOutput,
  creditCardsToolOutput,
  creditBuildingToolOutput,
  bnplToolOutput,
  tightMoneyToolOutput,
  carToolOutput,
} from "./debt-tools";

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
    case "debt_autopilot":
      return out(debtAutopilotToolOutput(await loadDebtAutopilot(userId, { client, now }), money));
    case "car_purchase": {
      const i = (input ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
      const apr = num(i.dealer_apr_percent);
      const months = num(i.dealer_months);
      const car = await loadCar(
        userId,
        {
          priceCents: num(i.price_cents) && Math.round(num(i.price_cents)!),
          dealer:
            apr !== undefined && months !== undefined
              ? { aprBps: Math.round(apr * 100), termMonths: Math.round(months), feesCents: 0 }
              : undefined,
        },
        { client, now },
      );
      return out(carToolOutput(car, money));
    }
    case "tight_money":
      return out(tightMoneyToolOutput(await loadTightMoney(userId, { client, now }), money));
    case "bnpl_installments": {
      const total = (input as { total_cents?: unknown } | null)?.total_cents;
      return out(
        bnplToolOutput(
          await loadBnpl(userId, { client, now }),
          typeof total === "number" && Number.isInteger(total) && total > 0 ? total : null,
          money,
        ),
      );
    }
    case "credit_building":
      return out(
        creditBuildingToolOutput(await loadCreditBuilding(userId, { client, now }), money),
      );
    case "credit_cards":
      return out(creditCardsToolOutput(await loadCreditCards(userId, { client, now }), money));
    case "credit_score":
      return out(creditToolOutput(await loadCredit(userId, { client, now }), money));
    case "mortgage":
      return out(mortgageToolOutput(await loadMortgage(userId, { client, now }), money));
    case "student_loans":
      return out(studentToolOutput(await loadStudentLoans(userId, { client, now }), money));
    case "balance_transfers":
      return out(transfersToolOutput(await loadTransfers(userId, { client, now }), money));
    case "loan_applications":
      return out(applicationsToolOutput(await listApplications(userId, { client }), money));
    case "refinance_offers":
      return out(refinanceToolOutput(await loadRefinance(userId, { client, now }), money));
    case "payoff_plan": {
      const payoff = await loadPayoff(userId, { client, now, extraCents: extraFromInput(input) });
      return out(payoffToolOutput(payoff, now.toISOString().slice(0, 10), money));
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
