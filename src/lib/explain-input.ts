import { createHash } from "node:crypto";
import { IDLE_CASH_MONTHS_OF_SPENDING } from "@/config/detection";
import type { FindingType } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";

// Turns a finding into exactly what Claude may see: its type, merchant names, amounts,
// dates and the savings estimate. Never account names or ids, transaction descriptions
// (they can hold names or card numbers), emails or tokens. Every dollar figure sent is
// remembered, so the guardrails can reject any other figure in the answer.

export type ExplainableFinding = {
  type: FindingType;
  annualSavingsCents: number | null;
  evidence: unknown;
};

type Fact = string | number | null;

export type ExplainInput = {
  findingType: FindingType;
  savingsPerYear: string | null;
  facts: Record<string, Fact | Record<string, Fact>[]>;
  charges: { date: string; amount: string; kind?: string }[];
};

export type PreparedInput = {
  input: ExplainInput;
  // Every amount in the input, in cents.
  allowedCents: number[];
};

// The most recent charges sent; enough to show a pattern.
const MAX_CHARGES = 6;

const FREQUENCY_WORDS: Record<string, string> = {
  WEEKLY: "weekly",
  BIWEEKLY: "every two weeks",
  SEMI_MONTHLY: "twice a month",
  MONTHLY: "monthly",
  QUARTERLY: "every three months",
  ANNUALLY: "yearly",
};

const FEE_WORDS: Record<string, string> = {
  BANK_FEES_ATM_FEES: "ATM fee",
  BANK_FEES_CASH_ADVANCE: "cash advance fee",
  BANK_FEES_FOREIGN_TRANSACTION_FEES: "foreign transaction fee",
  BANK_FEES_INSUFFICIENT_FUNDS: "insufficient funds fee",
  BANK_FEES_LATE_FEES: "late fee",
  BANK_FEES_OTHER_BANK_FEES: "bank fee",
  BANK_FEES_OVERDRAFT_FEES: "overdraft fee",
  BANK_FEES_INTEREST_CHARGE: "interest charge",
};

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export const frequencyWords = (value: unknown): string =>
  FREQUENCY_WORDS[text(value) ?? ""] ?? "regularly";

function percent(bps: number | null): string | null {
  return bps === null ? null : `${bps / 100}%`;
}

export function prepareExplainInput(finding: ExplainableFinding): PreparedInput {
  const allowedCents: number[] = [];
  const money = (cents: number | null): string | null => {
    if (cents === null) return null;
    allowedCents.push(cents);
    return formatCents(Math.abs(cents));
  };
  const charges = (rows: unknown, kinds = false) =>
    list(rows)
      .map(obj)
      .slice(-MAX_CHARGES)
      .map((c) => ({
        date: text(c.date) ?? "",
        amount: money(num(c.amountCents) ?? 0) ?? "",
        ...(kinds ? { kind: FEE_WORDS[text(c.category) ?? ""] ?? "fee" } : {}),
      }));

  const evidence = obj(finding.evidence);
  const savingsPerYear = money(finding.annualSavingsCents);
  const stream = (e: Json) => ({
    merchant: text(e.merchant),
    billed: frequencyWords(e.frequency),
    latestCharge: money(num(e.lastAmountCents)),
    yearlyCost: money(num(e.annualCostCents)),
  });

  let facts: ExplainInput["facts"] = {};
  let sent: ExplainInput["charges"] = [];
  switch (finding.type) {
    case "subscription_review":
    case "insurance_reshop":
      facts = stream(evidence);
      sent = charges(evidence.charges);
      break;
    case "price_increase": {
      const before = num(evidence.priorAverageCents);
      const after = num(evidence.lastAmountCents);
      facts = {
        ...stream(evidence),
        previousPrice: money(before),
        increasePerCharge: money(before !== null && after !== null ? after - before : null),
      };
      sent = charges(evidence.charges);
      break;
    }
    case "duplicate_subscription":
      facts = {
        kindOfService: text(evidence.group),
        services: list(evidence.services).map((s) => stream(obj(s))),
      };
      break;
    case "bank_fees":
    case "card_interest":
      facts = {
        account: finding.type === "card_interest" ? "credit card" : "bank account",
        totalLast12Months: money(num(evidence.totalCents)),
      };
      sent = charges(evidence.transactions, true);
      break;
    case "low_balance_risk":
      facts = {
        account: "checking account",
        balanceToday: money(num(evidence.balanceCents)),
        lowestBalance: money(num(evidence.lowestCents)),
        lowestAround: text(evidence.lowestDate),
        cushion: money(num(evidence.cushionCents)),
      };
      sent = list(evidence.bills)
        .map(obj)
        .slice(-MAX_CHARGES)
        .map((b) => ({ date: text(b.date) ?? "", amount: money(num(b.amountCents) ?? 0) ?? "" }));
      break;
    case "idle_cash":
      facts = {
        cashBalance: money(num(evidence.totalBalanceCents)),
        averageMonthlySpending: money(num(evidence.averageMonthlySpendingCents)),
        monthsOfSpendingKept: IDLE_CASH_MONTHS_OF_SPENDING,
        cushion: money(num(evidence.cushionCents)),
        extraCash: money(num(evidence.excessCents)),
        highYieldSavingsRate: percent(num(evidence.referenceRateBps)),
        assumedCurrentRate: percent(num(evidence.assumedCurrentRateBps)),
      };
      break;
  }

  return {
    input: { findingType: finding.type, savingsPerYear, facts, charges: sent },
    allowedCents,
  };
}

// Same input, same hash. A stored explanation with another hash is out of date.
export function inputHash(input: ExplainInput, promptVersion: string): string {
  return createHash("sha256").update(promptVersion).update(JSON.stringify(input)).digest("hex");
}
