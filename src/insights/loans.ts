import { LOAN_DUE_SOON_DAYS } from "@/config/loans";
import { SYNCED_KINDS, syncedKindOf } from "@/data-sources/types";

// What the person owes, card by card and loan by loan, from balances and the details the
// bank reports through Plaid Liabilities (spec step 65). Only what the bank says: nothing
// is estimated, and a missing detail stays missing. Pure.

export type DebtAccount = {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  liability: {
    aprBps: number | null;
    rateType: string | null;
    minimumPaymentCents: number | null;
    nextPaymentDueDate: Date | null;
    payoffDate: Date | null;
    isOverdue: boolean | null;
    pastDueCents: number | null;
    ytdInterestPaidCents: number | null;
    description: string | null;
  } | null;
};

export type DebtLine = {
  id: string;
  name: string;
  kindLabel: string;
  balanceCents: number | null;
  aprBps: number | null;
  rateType: string | null;
  monthlyCents: number | null;
  // YYYY-MM-DD.
  nextDue: string | null;
  dueSoon: boolean;
  payoffDate: string | null;
  overdue: boolean;
  pastDueCents: number | null;
  ytdInterestPaidCents: number | null;
  description: string | null;
};

export type DebtSummary = {
  lines: DebtLine[];
  totalOwedCents: number;
  // The monthly payments the bank reports, added up; lines without one are left out.
  totalMonthlyCents: number;
  // Lines with no monthly payment from the bank, so the total above leaves them out.
  missingMonthly: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? null;

export function debtSummary(accounts: DebtAccount[], asOf: string): DebtSummary {
  const today = Date.parse(`${asOf}T00:00:00Z`);
  const lines = accounts
    .filter((a) => a.type === "credit" || a.type === "loan")
    .map((a): DebtLine => {
      const kind = syncedKindOf(a.type, a.subtype);
      const l = a.liability;
      const nextDue = iso(l?.nextPaymentDueDate);
      const daysToDue =
        nextDue === null ? null : (Date.parse(`${nextDue}T00:00:00Z`) - today) / DAY_MS;
      return {
        id: a.id,
        name: a.mask ? `${a.name} ····${a.mask}` : a.name,
        kindLabel: kind ? SYNCED_KINDS[kind].label : (a.subtype ?? a.type),
        // A card in credit (negative balance) owes nothing.
        balanceCents: a.currentBalanceCents === null ? null : Math.max(0, a.currentBalanceCents),
        aprBps: l?.aprBps ?? null,
        rateType: l?.rateType ?? null,
        monthlyCents: l?.minimumPaymentCents ?? null,
        nextDue,
        dueSoon: daysToDue !== null && daysToDue >= 0 && daysToDue <= LOAN_DUE_SOON_DAYS,
        payoffDate: iso(l?.payoffDate),
        overdue: l?.isOverdue === true,
        pastDueCents: l?.pastDueCents ?? null,
        ytdInterestPaidCents: l?.ytdInterestPaidCents ?? null,
        // Left out when the name already says it ("Consolidation loan" / "Consolidation").
        description:
          l?.description && !a.name.toLowerCase().includes(l.description.toLowerCase())
            ? l.description
            : null,
      };
    })
    // Overdue first, then by the next due date, then by name.
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") ||
        a.name.localeCompare(b.name),
    );
  return {
    lines,
    totalOwedCents: lines.reduce((sum, l) => sum + (l.balanceCents ?? 0), 0),
    totalMonthlyCents: lines.reduce((sum, l) => sum + (l.monthlyCents ?? 0), 0),
    missingMonthly: lines.filter((l) => l.monthlyCents === null).length,
  };
}

// 2499 -> "24.99%".
export const formatRate = (bps: number) => `${(bps / 100).toFixed(2)}%`;
