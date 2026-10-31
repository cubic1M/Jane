import { createHash } from "node:crypto";
import { IDLE_CASH_MONTHS_OF_SPENDING } from "@/config/detection";
import { ANNUAL_FEE_WORDS } from "@/config/found-policies";
import type { FindingType } from "@/generated/prisma/client";
import { lastMonths } from "@/detection/rules/fee-totals";
import { dayLabel } from "@/lib/day-label";
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
  SEMIANNUALLY: "every six months",
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
  // A balance, which can be below zero: "-$680.15".
  const signedMoney = (cents: number | null): string | null => {
    if (cents === null) return null;
    allowedCents.push(cents);
    return formatCents(cents);
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
        total: money(num(evidence.totalCents)),
        // "the last 3 months": what the total covers (older findings don't say).
        ...(num(evidence.months) !== null ? { period: lastMonths(num(evidence.months)!) } : {}),
        // Only a card's annual fee (debugger 10-30): its own words, not an overdraft's.
        ...(finding.type === "bank_fees" &&
        list(evidence.transactions).length > 0 &&
        list(evidence.transactions).every((t) =>
          ANNUAL_FEE_WORDS.test(text(obj(t).description) ?? ""),
        )
          ? { feeKind: "annual fee" }
          : {}),
      };
      sent = charges(evidence.transactions, true);
      break;
    case "duplicate_charge":
    case "charge_after_cancel":
    case "trial_conversion":
      facts = {
        merchant: text(evidence.merchant),
        refundAmount: money(num(evidence.refundCents)),
        ...(finding.type === "charge_after_cancel"
          ? { cancelledOn: text(evidence.cancelledOn) }
          : {}),
        ...(finding.type === "trial_conversion"
          ? { trialCharge: money(num(evidence.trialCents)) }
          : {}),
      };
      sent = charges(evidence.charges);
      break;
    case "covered_by_card":
      facts = {
        ...stream(evidence),
        card: text(evidence.card),
        benefit: text(evidence.benefit),
        condition: text(evidence.condition),
        limits:
          list(evidence.limits)
            .map(obj)
            .map((l) => {
              const cents = num(l.cents);
              return [text(l.label), cents === null ? null : money(cents), text(l.text)]
                .filter(Boolean)
                .join(" ");
            })
            .join(", ") || null,
      };
      sent = charges(evidence.charges);
      break;
    case "bill_negotiation":
      facts = {
        ...stream(evidence),
        kindOfBill: text(evidence.billKind),
        perMonth: money(num(evidence.monthlyCents)),
        typicalPriceFrom: money(num(evidence.typicalLowCents)),
        typicalPriceTo: money(num(evidence.typicalHighCents)),
      };
      sent = charges(evidence.charges);
      break;
    case "low_balance_risk":
      facts = {
        account: "checking account",
        balanceToday: money(num(evidence.balanceCents)),
        // The low point keeps its sign and the day reads as people read it (night QA 10-30:
        // "down to about $680.15 around 2026-11-09" for a forecast of -$680.15 on Nov 9).
        lowestBalance: signedMoney(num(evidence.lowestCents)),
        lowestAround: text(evidence.lowestDate) && dayLabel(text(evidence.lowestDate)!),
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
        ...(num(evidence.setAsideCents) ? { heldBack: money(num(evidence.setAsideCents)) } : {}),
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
