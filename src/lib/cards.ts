import { createHash } from "node:crypto";
import type { ActionType, FindingType } from "@/generated/prisma/client";
import { explanationFor } from "@/lib/card-text";
import type { CardPartner } from "@/lib/referrals";

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
  // The referral partner this action uses, if any, and its disclosure word for word.
  referralPartner: { key: string; name: string } | null;
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
  low_balance_risk: "review_cash_flow",
  duplicate_charge: "request_refund",
  charge_after_cancel: "request_refund",
  trial_conversion: "request_refund",
  bill_negotiation: "negotiate_bill",
  // Spec step 152: the duplicate plan is cancelled through the usual flow.
  covered_by_card: "cancel_subscription",
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
      // Spec step 282: a loan option picked from the options card. Never an application.
      if (evidence.loanPick === true) {
        const lender = text(evidence.applyWith);
        return `We check the option you picked and send you ${lender ? `${lender}'s steps to apply yourself` : "the steps"}. Nothing is applied for and no money moves until you do it.`;
      }
      return "We ask your card company for a lower rate and look at balance transfer options for you.";
    case "low_balance_risk":
      return "We ask your billers to move due dates to after your payday, and remind you before the low point.";
    case "duplicate_charge":
      return `We ask ${merchant} to refund the second charge, and your card company if they don't.`;
    case "charge_after_cancel":
      return `We show ${merchant} the cancellation and ask for these charges back, and make sure it's really cancelled.`;
    case "bill_negotiation":
      if (evidence.dispute === true) {
        return `We ask ${merchant} and your health plan to check this bill against what your plan should have paid, and tell you what they say before you pay any more.`;
      }
      return `We call ${merchant}, ask for a lower rate or a cheaper plan with the same service, and tell you what they offer before anything changes.`;
    case "trial_conversion":
      return `We ask ${merchant} to refund the charge and cancel, before the next one.`;
    case "covered_by_card":
      return `We cancel your ${merchant} plan for you. Your ${text(evidence.card) ?? "card"} keeps covering you as long as ${text(evidence.condition) ?? "you use it"}.`;
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
    // Spec step 152: the card benefit's limits, then the plan's charges.
    case "covered_by_card":
      return [
        ...list(evidence.limits)
          .map(obj)
          .map((l) => ({
            date: null,
            label: `${text(evidence.benefit) ?? "Card cover"}: ${text(l.label) ?? ""}${text(l.text) ? (num(l.cents) === null ? ` ${text(l.text)}` : ` (${text(l.text)})`) : ""}`,
            amountCents: num(l.cents),
          })),
        ...transactionRows(evidence.charges),
      ];
    case "low_balance_risk":
      return list(evidence.bills)
        .map(obj)
        .map((b) => ({
          date: text(b.date),
          label: `${text(b.merchant) ?? "Bill"} (expected)`,
          amountCents: num(b.amountCents),
        }));
    default:
      return transactionRows(evidence.charges);
  }
}

// A card that uses a referral partner always carries the partner's disclosure: a partner
// without one is refused rather than shown silently.
export function buildCard(finding: CardFinding, partner: CardPartner | null = null): DecisionCard {
  if (partner && !partner.disclosure.trim()) {
    throw new Error(`Referral partner ${partner.key} has no disclosure`);
  }
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
    referralPartner: partner ? { key: partner.key, name: partner.name } : null,
    referralDisclosure: partner ? partner.disclosure : null,
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
