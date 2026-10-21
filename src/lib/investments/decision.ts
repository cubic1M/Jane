import { HIGH_DEBT_APR_BPS, SOON_GOAL_MONTHS } from "@/config/investing-decisions";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadCrypto } from "@/lib/crypto/crypto";
import { loadDebts } from "@/lib/debts";
import { db as defaultClient } from "@/lib/db";
import { listGoals } from "@/lib/goals";
import type { DecisionFacts } from "@/planning/investing-decision";
import { profileSummary } from "@/planning/investor-profile";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadCash } from "./cash";
import { loadInvestments } from "./holdings";
import { profileOf } from "./profile";
import { loadBaseline as loadWhatIfBaseline } from "@/lib/what-if";

// The person's own numbers behind an investing decision (the chat): high-interest debt, the
// emergency fund, money needed soon, what is invested and in crypto, and their risk label.

type Options = { client?: PrismaClient; now?: Date };

const sumOf = (
  accounts: readonly { subtype: string | null; balanceCents: number | null }[],
  subtypes: readonly string[],
) =>
  accounts
    .filter((a) => subtypes.includes((a.subtype ?? "").toLowerCase()))
    .reduce((s, a) => s + (a.balanceCents ?? 0), 0);

export async function loadDecisionFacts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DecisionFacts> {
  const asOf = now.toISOString().slice(0, 10);
  const [advice, book, investments, cash, goals, answers, crypto, tax, baseline] =
    await Promise.all([
      adviceMode(userId, { client }),
      loadDebts(userId, { client, now }),
      loadInvestments(userId, { client, now }),
      loadCash(userId, { client, now }),
      listGoals(userId, { client, now }),
      profileOf(userId, { client }),
      loadCrypto(userId, { client, now }).catch(() => null),
      loadTaxEstimate(userId, { client, now }).catch(() => null),
      loadWhatIfBaseline(userId, { client, now }).catch(() => null),
    ]);
  const owed = book.debts
    .filter((d) => d.balanceCents !== null && d.balanceCents > 0 && d.aprBps !== null)
    .map((d) => ({ name: d.name, balanceCents: d.balanceCents!, aprBps: d.aprBps! }));
  const highDebts = owed
    .filter((d) => d.aprBps >= HIGH_DEBT_APR_BPS)
    .sort((a, b) => b.aprBps - a.aprBps || b.balanceCents - a.balanceCents);
  const worst = [...owed].sort((a, b) => b.aprBps - a.aprBps)[0];
  const savings = cash.places
    .filter((p) => p.kind === "savings")
    .reduce((s, p) => s + p.balanceCents, 0);
  const today = Date.parse(`${asOf}T00:00:00Z`);
  const soon = goals
    .flatMap((g) => {
      if (g.progress.status !== "on_the_way") return [];
      const months = Math.max(
        1,
        Math.round((Date.parse(`${g.targetDate}T00:00:00Z`) - today) / (30.44 * 86_400_000)),
      );
      return months <= SOON_GOAL_MONTHS && !/emergency/i.test(g.name)
        ? [{ name: g.name, leftCents: g.progress.leftCents, months }]
        : [];
    })
    .sort((a, b) => a.months - b.months)[0];
  const profile = profileSummary(answers, asOf);
  return {
    advice,
    highDebts,
    topDebt: worst ? { name: worst.name, aprBps: worst.aprBps } : null,
    emergencyTargetCents: cash.emergencyTargetCents,
    savingsCents: savings,
    investedCents: investments.totalCents,
    cryptoCents: crypto ? crypto.connections.reduce((s, c) => s + c.totalCents, 0) : 0,
    soonGoal: soon ?? null,
    riskLabel: profile.complete ? profile.label : null,
    monthlyIncomeCents: baseline?.monthlyIncomeCents ?? null,
    marginalRate: tax?.estimate.marginalRate ?? baseline?.marginalRate ?? null,
    hsaCents: sumOf(investments.accounts, ["hsa"]),
    preTaxCents: sumOf(investments.accounts, ["401k", "403b", "457b", "ira"]),
    rothCents: sumOf(investments.accounts, ["roth", "roth 401k", "roth 403b"]),
    monthlySpendCents: baseline?.monthlySpendingCents ?? null,
    askedAge: null,
    hasFamilyPlan: tax?.estimate.filingStatus?.startsWith("married") ?? false,
  };
}
