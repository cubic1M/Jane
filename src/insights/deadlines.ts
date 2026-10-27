import {
  DEADLINE_HORIZON_DAYS,
  DEADLINE_KINDS_REMINDED_ELSEWHERE,
  DEADLINE_MONTH_DAYS,
  DEADLINE_REMINDER_DAYS,
  DEADLINE_WEEK_DAYS,
  RETURN_MIN_CENTS,
  RETURN_ROUTINE_MEDIAN_MULTIPLE,
  RETURN_ROUTINE_MIN_PURCHASES,
  RETURN_REMINDER_DAYS,
  RETURN_WINDOW_DAYS,
  RETURN_WINDOW_OVERRIDES,
  RETURNABLE_CATEGORIES,
  TRIAL_LENGTH_DAYS,
} from "@/config/deadlines";
import {
  RENEWAL_FREQUENCIES,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_MERCHANTS,
  TRIAL_MAX_START_CENTS,
} from "@/config/detection";
import type { AlertCandidate } from "@/detection/alerts";
import { expectedDates } from "@/detection/forecast";
import { byDate, inList, inLookback, isRenewable, merchantMatches } from "@/detection/helpers";
import { merchantOf, type Stream } from "@/detection/streams";
import type { DetectionInput, DetectionTransaction } from "@/detection/types";
import { addDays, daysBetween, median } from "@/detection/units";
import { debtSummary, type DebtAccount } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import { dayLabel } from "@/lib/day-label";

// Deadlines (spec step 71): return windows, trials, renewals, card and loan payments and
// the person's own dates (FSA, card benefits, warranties), in one list. Each source here is
// pure: the person's data in, deadlines out. src/lib/deadlines.ts loads the data, keeps the
// hand-entered ones and sends the reminders.

export type DeadlineKind =
  | "renewal"
  | "trial"
  | "return"
  | "payment"
  | "fsa"
  | "card_benefit"
  | "warranty"
  | "other"
  // Spec step 243: an intro price ending, or a yearly plan renewing at its price.
  | "price_rise";

// Where a deadline came from.
export type DeadlineOrigin = "transactions" | "loans" | "entered" | "documents" | "insurance";

export type Deadline = {
  // Stable across days and rescans (and names the date where it can move), so a reminder
  // is raised once.
  key: string;
  title: string;
  // YYYY-MM-DD.
  date: string;
  kind: DeadlineKind;
  source: DeadlineOrigin;
  amountCents: number | null;
  // Where to look or act: the subscriptions page, the purchase, the loan.
  href: string | null;
  // A line of detail under the title.
  detail: string | null;
  // The deadlines row, for ones the person typed in (to mark done or delete).
  entryId?: string;
};

export const DEADLINE_KIND_LABELS: Record<DeadlineKind, string> = {
  renewal: "Renewal",
  trial: "Trial ends",
  return: "Return by",
  payment: "Payment due",
  fsa: "FSA",
  card_benefit: "Card benefit",
  warranty: "Warranty",
  other: "Reminder",
  price_rise: "Price goes up",
};

const merchantName = (t: DetectionTransaction) =>
  t.merchantName ?? merchantOf(t)?.name ?? t.description;

const purchaseLink = (merchant: string) => `/transactions?${new URLSearchParams({ q: merchant })}`;

// Yearly and quarterly subscriptions' next charge. Monthly ones come round too often to be
// a deadline; they're on /bills.
export function renewalDeadlines(input: DetectionInput, streams: Stream[]): Deadline[] {
  const until = addDays(input.asOf, DEADLINE_HORIZON_DAYS);
  return streams
    .filter(
      (s) =>
        s.active &&
        s.frequency !== null &&
        RENEWAL_FREQUENCIES.includes(s.frequency) &&
        isRenewable(s),
    )
    .flatMap((s) =>
      expectedDates(s, input.asOf, until)
        .slice(0, 1)
        .map((date): Deadline => ({
          key: `renewal:${s.key}:${date}`,
          title: `${s.merchant} renews`,
          date,
          kind: "renewal",
          source: "transactions",
          amountCents: s.lastAmountCents,
          href: "/subscriptions",
          detail: `About ${formatCents(s.lastAmountCents)} ${s.frequency === "ANNUALLY" ? "for another year" : "for another quarter"}. Cancel before then if you don't want it.`,
        })),
    );
}

// A subscription-like merchant whose only charge so far is a tiny first one, like a $1
// trial: the full price usually follows. The date is an estimate (TRIAL_LENGTH_DAYS).
// Once the full charge comes, the trial_conversion finding takes over.
export function trialDeadlines(input: DetectionInput): Deadline[] {
  const confirmed = input.subscriptionMerchantKeys ?? [];
  const byMerchant = new Map<string, DetectionTransaction[]>();
  for (const t of inLookback(input)) {
    if (t.amountCents <= 0) continue;
    const key = merchantOf(t)?.key;
    if (key) byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }
  return [...byMerchant]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([merchantKey, charges]): Deadline[] => {
      if (charges.length !== 1) return [];
      const [start] = charges;
      const subscriptionLike =
        inList(start.pfcDetailed, SUBSCRIPTION_CATEGORIES) ||
        merchantMatches(merchantKey, SUBSCRIPTION_MERCHANTS) ||
        confirmed.includes(merchantKey);
      if (!subscriptionLike || start.amountCents > TRIAL_MAX_START_CENTS) return [];
      const date = addDays(start.date, TRIAL_LENGTH_DAYS);
      if (date < input.asOf) return [];
      const merchant = merchantName(start);
      return [
        {
          key: `trial:${start.id}`,
          title: `${merchant} trial may end`,
          date,
          kind: "trial",
          source: "transactions",
          amountCents: null,
          href: purchaseLink(merchant),
          detail: `It started with ${formatCents(start.amountCents)} on ${dayLabel(start.date)}. If it's a trial, the full price usually follows; cancel first if you don't want it. The date is an estimate.`,
        },
      ];
    });
}

// Usual return window for a merchant, in days.
export function returnWindowDays(merchantKey: string | undefined): number {
  const override = merchantKey
    ? RETURN_WINDOW_OVERRIDES.find((o) => merchantMatches(merchantKey, [o.merchant]))
    : undefined;
  return override?.days ?? RETURN_WINDOW_DAYS;
}

// A one-off purchase of RETURN_MIN_CENTS or more, in a shop that takes returns, whose
// window hasn't closed. A refund of the same amount from the same merchant after it means
// it was already returned.
export function returnDeadlines(input: DetectionInput, streams: Stream[]): Deadline[] {
  const recurring = new Set(streams.flatMap((s) => s.charges.map((c) => c.id)));
  const refunds = input.transactions.filter((t) => t.amountCents < 0);
  // What the person usually spends at each shop, to tell a routine run from a one-off.
  const paid = new Map<string, number[]>();
  for (const t of inLookback(input)) {
    const key = merchantOf(t)?.key;
    if (!key || t.amountCents <= 0) continue;
    paid.set(key, [...(paid.get(key) ?? []), t.amountCents]);
  }
  const routine = (t: DetectionTransaction) => {
    const amounts = paid.get(merchantOf(t)?.key ?? "") ?? [];
    return (
      amounts.length >= RETURN_ROUTINE_MIN_PURCHASES &&
      t.amountCents <= median(amounts) * RETURN_ROUTINE_MEDIAN_MULTIPLE
    );
  };
  return inLookback(input)
    .filter(
      (t) =>
        t.amountCents >= RETURN_MIN_CENTS &&
        !recurring.has(t.id) &&
        inList(t.pfcDetailed, RETURNABLE_CATEGORIES) &&
        !routine(t),
    )
    .sort(byDate)
    .flatMap((t): Deadline[] => {
      const merchantKey = merchantOf(t)?.key;
      const days = returnWindowDays(merchantKey);
      const listed = days !== RETURN_WINDOW_DAYS;
      const date = addDays(t.date, days);
      if (date < input.asOf) return [];
      const returned = refunds.some(
        (r) =>
          r.date >= t.date &&
          r.amountCents === -t.amountCents &&
          merchantOf(r)?.key === merchantKey,
      );
      if (returned) return [];
      const merchant = merchantName(t);
      return [
        {
          key: `return:${t.id}`,
          title: `Return window for ${merchant}`,
          date,
          kind: "return",
          source: "transactions",
          amountCents: t.amountCents,
          href: purchaseLink(merchant),
          detail: `${formatCents(t.amountCents)} on ${dayLabel(t.date)}. ${listed ? `${merchant} usually takes` : "Most shops take"} returns within ${days} days; your receipt has the exact date.`,
        },
      ];
    });
}

// Card and loan payments' next due date, as the bank reports it (spec step 65).
export function paymentDeadlines(accounts: DebtAccount[], asOf: string): Deadline[] {
  const until = addDays(asOf, DEADLINE_HORIZON_DAYS);
  return debtSummary(accounts, asOf).lines.flatMap((line): Deadline[] =>
    line.nextDue && line.nextDue >= asOf && line.nextDue <= until
      ? [
          {
            key: `payment:${line.id}:${line.nextDue}`,
            title: `${line.name} payment`,
            date: line.nextDue,
            kind: "payment",
            source: "loans",
            amountCents: line.monthlyCents,
            href: "/loans",
            detail:
              line.monthlyCents === null
                ? `${line.kindLabel}; your bank didn't report the amount.`
                : `${line.kindLabel}, ${formatCents(line.monthlyCents)} due.`,
          },
        ]
      : [],
  );
}

// A date read from an uploaded document (spec step 68's documentDates).
export type DocumentDate = {
  documentId: string;
  title: string;
  // YYYY-MM-DD.
  date: string;
  what: "renewal" | "warranty_end" | "return_window";
};

const DOCUMENT_DEADLINES: Record<
  DocumentDate["what"],
  { kind: DeadlineKind; title: (name: string) => string; detail: string }
> = {
  renewal: {
    kind: "renewal",
    title: (name) => `${name} renews`,
    detail: "From the policy you uploaded. A good time to compare prices before it renews.",
  },
  warranty_end: {
    kind: "warranty",
    title: (name) => `${name} warranty ends`,
    detail: "From the warranty you uploaded. Get anything covered looked at before then.",
  },
  return_window: {
    kind: "return",
    title: (name) => `Return window for ${name}`,
    detail:
      "From the receipt you uploaded. Most shops take returns for about 30 days; the receipt has the exact date.",
  },
};

// Dates from the person's uploaded policies, warranties and receipts.
export function fromDocumentDates(dates: DocumentDate[]): Deadline[] {
  return dates.map((d): Deadline => {
    const shape = DOCUMENT_DEADLINES[d.what];
    return {
      key: `document:${d.documentId}:${d.what}:${d.date}`,
      title: shape.title(d.title),
      date: d.date,
      kind: shape.kind,
      source: "documents",
      amountCents: null,
      href: "/documents",
      detail: shape.detail,
    };
  });
}

export type EnteredDeadline = {
  id: string;
  title: string;
  dueOn: Date;
  kind: "fsa" | "card_benefit" | "warranty" | "other";
  note: string | null;
  doneAt: Date | null;
};

// The ones the person typed in, until they mark them done. Passed ones stay, so they can
// be marked done or deleted.
export function enteredDeadlines(rows: EnteredDeadline[]): Deadline[] {
  return rows
    .filter((r) => r.doneAt === null)
    .map((r): Deadline => {
      const date = r.dueOn.toISOString().slice(0, 10);
      return {
        key: `entered:${r.id}:${date}`,
        title: r.title,
        date,
        kind: r.kind,
        source: "entered",
        amountCents: null,
        href: null,
        detail: r.note,
        entryId: r.id,
      };
    });
}

// Soonest first, then by title; only the next DEADLINE_HORIZON_DAYS, plus the person's own
// that have passed. The same key twice (two sources agreeing) is kept once.
export function upcomingDeadlines(deadlines: Deadline[], asOf: string): Deadline[] {
  const until = addDays(asOf, DEADLINE_HORIZON_DAYS);
  const seen = new Set<string>();
  return deadlines
    .filter((d) => d.date <= until && (d.date >= asOf || d.source === "entered"))
    .filter((d) => !seen.has(d.key) && Boolean(seen.add(d.key)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export type DeadlineGroup = {
  label: "Passed" | "This week" | "This month" | "Later";
  deadlines: Deadline[];
};

// The page's groups, in order, leaving out empty ones.
export function groupDeadlines(deadlines: Deadline[], asOf: string): DeadlineGroup[] {
  const groups: DeadlineGroup[] = [
    { label: "Passed", deadlines: [] },
    { label: "This week", deadlines: [] },
    { label: "This month", deadlines: [] },
    { label: "Later", deadlines: [] },
  ];
  for (const d of deadlines) {
    const days = daysBetween(asOf, d.date);
    const index = days < 0 ? 0 : days < DEADLINE_WEEK_DAYS ? 1 : days < DEADLINE_MONTH_DAYS ? 2 : 3;
    groups[index].deadlines.push(d);
  }
  return groups.filter((g) => g.deadlines.length > 0);
}

// "today", "tomorrow", "in 5 days".
export function dueIn(date: string, asOf: string): string {
  const days = daysBetween(asOf, date);
  if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export const reminderDays = (kind: DeadlineKind) =>
  kind === "return" ? RETURN_REMINDER_DAYS : DEADLINE_REMINDER_DAYS;

// A deadline_soon reminder for each deadline coming up within its reminder days, keyed by
// the deadline, so it's raised once (the alerts table's unique index). Renewals and
// payments Jane found in the accounts are left out: "Renews soon" and "Bill due soon"
// already remind about them.
export function deadlineAlerts(deadlines: Deadline[], asOf: string): AlertCandidate[] {
  return deadlines
    .filter((d) => d.source === "documents" || !DEADLINE_KINDS_REMINDED_ELSEWHERE.includes(d.kind))
    .filter((d) => {
      const days = daysBetween(asOf, d.date);
      return days >= 0 && days <= reminderDays(d.kind);
    })
    .map((d): AlertCandidate => ({
      type: "deadline_soon",
      key: d.key,
      title: `${d.title}: ${dayLabel(d.date)} (${dueIn(d.date, asOf)})`,
      body: `${d.detail ? `${d.detail} ` : ""}All your dates are on the deadlines page.`,
    }));
}
