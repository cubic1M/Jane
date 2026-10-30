import { DEADLINE_HORIZON_DAYS } from "@/config/deadlines";
import {
  ANNUAL_FEE_WORDS,
  FOUND_START_SEEN_DAYS,
  FOUND_TERM_MONTHS,
  INSURANCE_CATEGORIES,
  INSURER_KINDS,
  INSURER_NAMES,
  PREMIUM_FREQUENCY_OF,
} from "@/config/found-policies";
import type { PremiumFrequency } from "@/config/documents";
import type { PolicyKind } from "@/config/insurance";
import { byDate, inList, merchantMatches } from "@/detection/helpers";
import type { Stream } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { addDays, daysBetween } from "@/detection/units";
import { formatCents } from "@/lib/money";
import type { Deadline } from "./deadlines";
import { addMonths } from "@/lib/dates";

// Insurance and renewals from payments (spec step 99). Pure: regular payments to an
// insurer become policies "found from your payments", with a renewal estimated a term from
// the first payment seen; card annual fees become deadlines.

export type FoundPolicy = {
  merchantKey: string;
  carrier: string;
  kind: PolicyKind;
  premiumCents: number;
  premiumFrequency: PremiumFrequency;
  // An estimate (YYYY-MM-DD): a yearly or half-yearly premium's next due date, or a term from
  // the first payment when the statements show it starting. Null when the payments began
  // before the statements: the renewal isn't known.
  renewalDate: string | null;
  termMonths: number;
};

export function insurerKind(merchantKey: string): PolicyKind | null {
  return INSURER_KINDS.find((i) => merchantMatches(merchantKey, i.words))?.kind ?? null;
}

// A known insurer's own name ("GEICO", "State Farm"), not the statement's words around it
// (overnight upload QA: "Geico Auto Payment car", "State Farm Ro 27 car"). Null: not known.
export function insurerName(merchantKey: string): string | null {
  const word = INSURER_KINDS.flatMap((i) => i.words).find((w) => merchantMatches(merchantKey, [w]));
  if (!word) return null;
  return INSURER_NAMES[word] ?? word.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// The first anniversary of `from`, a term at a time, on or after asOf.
export function estimatedRenewal(from: string, asOf: string, termMonths: number): string {
  let next = addMonths(from, termMonths);
  for (let i = 2; next < asOf && i < 100; i += 1) next = addMonths(from, termMonths * i);
  return next;
}

// A premium paid once a term marks its renewal; these terms, in months.
const PAID_PER_TERM: Partial<Record<PremiumFrequency, number>> = { yearly: 12, semiannual: 6 };

export function policiesFromStreams(input: DetectionInput, streams: Stream[]): FoundPolicy[] {
  const dataFrom =
    input.historyFrom ??
    input.transactions.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
  return streams.flatMap((s): FoundPolicy[] => {
    const frequency = s.frequency && PREMIUM_FREQUENCY_OF[s.frequency];
    const first = s.charges[0];
    if (!s.active || !frequency || !first) return [];
    const kind = insurerKind(s.merchantKey);
    // An insurer's name counts only for services (USAA and Nationwide are banks too).
    const byName = kind !== null && (s.pfcPrimary === null || s.pfcPrimary === "GENERAL_SERVICES");
    if (!byName && !inList(s.pfcDetailed, INSURANCE_CATEGORIES)) return [];
    const perTerm = PAID_PER_TERM[frequency];
    const last = s.charges.at(-1)!;
    const startSeen = daysBetween(dataFrom, first.date) >= FOUND_START_SEEN_DAYS;
    return [
      {
        merchantKey: s.merchantKey,
        carrier: insurerName(s.merchantKey) ?? s.merchant,
        kind: kind ?? "other",
        premiumCents: s.lastAmountCents,
        premiumFrequency: frequency,
        renewalDate: perTerm
          ? estimatedRenewal(last.date, input.asOf, perTerm)
          : startSeen
            ? estimatedRenewal(first.date, input.asOf, FOUND_TERM_MONTHS)
            : null,
        termMonths: perTerm ?? FOUND_TERM_MONTHS,
      },
    ];
  });
}

// A card's annual fee, due again a year after it was last charged, if that's within the
// deadlines' horizon.
export function annualFeeDeadlines(input: DetectionInput): Deadline[] {
  const until = addDays(input.asOf, DEADLINE_HORIZON_DAYS);
  const latest = new Map<string, (typeof input.transactions)[number]>();
  for (const t of [...input.transactions].sort(byDate)) {
    if (t.amountCents > 0 && ANNUAL_FEE_WORDS.test(t.description)) latest.set(t.accountId, t);
  }
  return [...latest.values()].flatMap((t): Deadline[] => {
    const date = addMonths(t.date, 12);
    if (date < input.asOf || date > until) return [];
    const account = input.accounts.find((a) => a.id === t.accountId)?.name ?? "your card";
    return [
      {
        key: `annual_fee:${t.accountId}:${date}`,
        title: `${account}'s annual fee`,
        date,
        kind: "renewal",
        source: "transactions",
        amountCents: t.amountCents,
        href: "/transactions",
        detail: `About ${formatCents(t.amountCents)}, a year after the last one (an estimate). If the card isn't worth it, ask about a no-fee version before then.`,
      },
    ];
  });
}
