import { createHash } from "node:crypto";
import { REFERRAL_PARTNERS } from "@/config/referrals";
import type { ActionType, FindingType } from "@/generated/prisma/client";
import { explanationFor } from "@/lib/card-text";

// The decision card: everything the person sees before saying yes or no. The same object
// is saved word for word with their decision, and its hash makes sure the card they
// answered is the card we save.

export type CardEvidenceRow = { date: string | null; label: string; amountCents: number | null };

export type DecisionCard = {
  findingId: string;
  findingType: FindingType;
  actionType: ActionType;
  title: string;
  explanation: string;
  whatChanges: string;
  // Always an estimate; null when we can't put a number on it (insurance).
  annualSavingsCents: number | null;
  giveUp: string;
  alternatives: string[];
  evidence: CardEvidenceRow[];
  referralDisclosure: string | null;
};

export type CardFinding = Parameters<typeof explanationFor>[0] & { id: string };

export const ACTION_FOR_FINDING: Record<FindingType, ActionType> = {
  subscription_review: "cancel_subscription",
  duplicate_subscription: "cancel_subscription",
  price_increase: "fight_price_increase",
  bank_fees: "recover_bank_fees",
  idle_cash: "move_idle_cash",
  insurance_reshop: "insurance_reshop",
  card_interest: "card_interest",
};

// Recent rows shown as proof on the card.
const MAX_EVIDENCE_ROWS = 6;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

function whatChanges(type: FindingType, evidence: Json): string {
  const merchant = text(evidence.merchant) ?? "the company";
  switch (type) {
    case "subscription_review":
      return `We cancel your ${merchant} subscription for you.`;
    case "duplicate_subscription":
      return "We ask which service you want to keep, then cancel the others for you.";
    case "price_increase":
      return `We contact ${merchant} and ask for your old price or a cheaper plan.`;
    case "bank_fees":
      return "We ask your bank or card company to refund these fees and help you avoid new ones.";
    case "idle_cash":
      return "We help you open a high-yield savings account and move the extra cash there.";
    case "insurance_reshop":
      return `We get quotes with the same coverage as your ${merchant} policy and show you any cheaper option before anything changes.`;
    case "card_interest":
      return "We ask your card company for a lower rate and look at balance transfer options for you.";
  }
}

const transactionRows = (rows: unknown): CardEvidenceRow[] =>
  list(rows)
    .map(obj)
    .slice(-MAX_EVIDENCE_ROWS)
    .reverse()
    .map((t) => ({
      date: text(t.date),
      label: text(t.description) ?? "",
      amountCents: num(t.amountCents),
    }));

function evidenceRows(type: FindingType, evidence: Json): CardEvidenceRow[] {
  switch (type) {
    case "duplicate_subscription":
      return list(evidence.services)
        .map(obj)
        .map((s) => ({
          date: null,
          label: `${text(s.merchant) ?? "Service"}, about a year`,
          amountCents: num(s.annualCostCents),
        }));
    case "idle_cash":
      return [
        ...list(evidence.accounts)
          .map(obj)
          .map((a) => ({
            date: null,
            label: text(a.name) ?? "Account",
            amountCents: num(a.balanceCents),
          })),
        {
          date: null,
          label: "Average monthly spending",
          amountCents: num(evidence.averageMonthlySpendingCents),
        },
        { date: null, label: "Cash above your cushion", amountCents: num(evidence.excessCents) },
      ];
    case "bank_fees":
    case "card_interest":
      return transactionRows(evidence.transactions);
    default:
      return transactionRows(evidence.charges);
  }
}

export function buildCard(finding: CardFinding): DecisionCard {
  const evidence = obj(finding.evidence);
  const text = explanationFor(finding);
  const actionType = ACTION_FOR_FINDING[finding.type];
  return {
    findingId: finding.id,
    findingType: finding.type,
    actionType,
    title: text.title,
    explanation: text.explanation,
    whatChanges: whatChanges(finding.type, evidence),
    annualSavingsCents: finding.annualSavingsCents,
    giveUp: text.giveUp,
    alternatives: text.alternatives,
    evidence: evidenceRows(finding.type, evidence),
    referralDisclosure: REFERRAL_PARTNERS[actionType]?.disclosure ?? null,
  };
}

// Identifies one exact version of a card. The page sends it back with the answer.
export function cardHash(card: DecisionCard): string {
  return createHash("sha256").update(JSON.stringify(card)).digest("hex");
}

// Fields needed to build a card, for Prisma selects.
export const CARD_SELECT = {
  id: true,
  type: true,
  title: true,
  annualSavingsCents: true,
  evidence: true,
  explanation: true,
  explanationHash: true,
} as const;
