import {
  DEADLINE_HORIZON_DAYS,
  DEADLINE_MAX_YEARS_AHEAD,
  DEADLINE_NOTE_MAX,
  DEADLINE_TITLE_MAX,
} from "@/config/deadlines";
import { POLICY_KINDS } from "@/config/insurance";
import { loadDetectionInput } from "@/detection/engine";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { addDays, isoDate } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  deadlineAlerts,
  enteredDeadlines,
  fromDocumentDates,
  paymentDeadlines,
  renewalDeadlines,
  returnDeadlines,
  trialDeadlines,
  upcomingDeadlines,
  type Deadline,
} from "@/insights/deadlines";
import { annualFeeDeadlines } from "@/insights/found-policies";
import { raiseAlerts } from "@/lib/alerts";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { documentDates } from "@/lib/documents/dates";
import { openEnrollmentDates } from "@/lib/insurance/health";
import { listBenefits, openEnrollmentAtWork } from "@/lib/insurance/benefits";
import { listPolicies, nextRenewal } from "@/lib/insurance/policies";
import { loadInsurance } from "@/lib/insurance/profile";
import { priceRiseDeadlines } from "@/lib/price-rises";
import { peopleIn, type OnlyPeople } from "@/lib/only-people";
import { DEBT_ACCOUNT_SELECT } from "@/insights/loans";

// Deadlines (spec step 71): loads each source's data, keeps the deadlines the person types
// in, and raises the deadline_soon reminders (src/insights/deadlines.ts decides which).

type Options = { client?: PrismaClient; now?: Date };

export type SourceOptions = { client: PrismaClient; now: Date };

// One place deadlines come from. Each gets the person's id and returns their deadlines.
export type DeadlineSource = (userId: string, options: SourceOptions) => Promise<Deadline[]>;

// Renewals, trials and return windows, from transactions already loaded (Today has them
// to hand, spec step 79).
export const transactionDeadlinesFrom =
  (loaded: DetectionInput): DeadlineSource =>
  async (userId, { client }) => {
    const confirmed = await scopedFor(userId, client).subscriptionChecks.findMany({
      where: { isSubscription: true },
      select: { merchantKey: true },
    });
    const input = { ...loaded, subscriptionMerchantKeys: confirmed.map((c) => c.merchantKey) };
    const streams = buildStreams(input);
    return [
      ...renewalDeadlines(input, streams),
      ...trialDeadlines(input),
      ...returnDeadlines(input, streams),
      // Spec step 99.
      ...annualFeeDeadlines(input),
    ];
  };

// Renewals, trials and return windows, from the transactions.
export const transactionDeadlines: DeadlineSource = async (userId, options) =>
  transactionDeadlinesFrom(await loadDetectionInput(userId, options))(userId, options);

// Card and loan due dates the bank reports (spec step 65).
export const loanDeadlines: DeadlineSource = async (userId, { client, now }) => {
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: { type: { in: ["credit", "loan"] } },
    select: DEBT_ACCOUNT_SELECT,
  });
  return paymentDeadlines(accounts, isoDate(now));
};

// The ones the person typed in.
export const handEnteredDeadlines: DeadlineSource = async (userId, { client }) =>
  enteredDeadlines(
    await scopedFor(userId, client).deadlines.findMany({
      where: { doneAt: null },
      select: { id: true, title: true, dueOn: true, kind: true, note: true, doneAt: true },
    }),
  );

// Dates read from uploaded policies, warranties and receipts (spec step 68): renewals,
// warranty ends and receipts' return windows.
export const documentDeadlines: DeadlineSource = async (userId, { client }) =>
  fromDocumentDates(await documentDates(userId, { client }));

// Insurance renewals from the profile (spec step 99), confirmed or found from payments
// (an estimate until confirmed). A policy read from a document has its date from the
// document already.
export const insuranceDeadlines: DeadlineSource = async (userId, { client, now }) => {
  const asOf = isoDate(now);
  const until = addDays(asOf, DEADLINE_HORIZON_DAYS);
  const policies = await listPolicies(userId, { client });
  return policies.flatMap((p): Deadline[] => {
    if (p.documentId || (p.status !== "active" && p.status !== "found")) return [];
    const date = nextRenewal(p, asOf);
    if (!date || date > until) return [];
    const name = `${p.carrier} ${POLICY_KINDS[p.kind].toLowerCase()} insurance`;
    const found = p.status === "found";
    return [
      {
        key: `policy:${p.id}:${date}`,
        title: found ? `${name} renews (estimate)` : `${name} renews`,
        date,
        kind: "renewal",
        source: "insurance",
        amountCents: p.premiumCents,
        href: "/insurance",
        detail: found
          ? "Worked out from your payments, so the date is an estimate. Confirm the policy to keep it on your profile."
          : "A good time to compare prices before it renews.",
      },
    ];
  });
};

// Spec step 149: marketplace open enrollment, for people with a health plan, or with other
// policies on file and no health cover (a health gap): when it opens and its last day,
// within the horizon.
export const openEnrollmentDeadlines: DeadlineSource = async (userId, { client, now }) => {
  const asOf = isoDate(now);
  const until = addDays(asOf, DEADLINE_HORIZON_DAYS);
  const { policies, gaps } = await loadInsurance(userId, { client, now });
  const health = policies.some((p) => p.kind === "health" && p.status === "active");
  // Without a plan: only for people keeping their insurance with Jane and missing health cover.
  const missing =
    gaps.some((g) => g.key === "health") && policies.some((p) => p.status === "active");
  if (!health && !missing) return [];
  return openEnrollmentDates(asOf).flatMap(({ date, what, year }): Deadline[] =>
    date > until
      ? []
      : [
          {
            key: `open-enrollment:${year}:${what}`,
            title:
              what === "start"
                ? "Marketplace health plans open for next year"
                : "Last day to pick a marketplace health plan",
            date,
            kind: "renewal",
            source: "insurance",
            amountCents: null,
            href: "/insurance",
            detail: health
              ? "Compare plans on what they'd cost in a year with your usual care, not the premium alone."
              : "There's no health plan on file: this is when you can get one.",
          },
        ],
  );
};

// Spec step 150: the employer's open enrollment, for people with benefits through work on file.
export const workEnrollmentDeadlines: DeadlineSource = async (userId, { client, now }) => {
  const asOf = isoDate(now);
  const until = addDays(asOf, DEADLINE_HORIZON_DAYS);
  const window = await openEnrollmentAtWork(userId, { client, now });
  if (!window) return [];
  const benefits = await listBenefits(userId, { client });
  if (!benefits.some((b) => b.status === "confirmed" || b.status === "found")) return [];
  const dates = [
    ...(window.start >= asOf ? [{ date: window.start, what: "start" }] : []),
    { date: window.end, what: "end" },
  ];
  return dates.flatMap(({ date, what }): Deadline[] =>
    date > until
      ? []
      : [
          {
            key: `work-enrollment:${window.end}:${what}`,
            title:
              what === "start"
                ? `Open enrollment at ${window.employer} starts`
                : `Last day of open enrollment at ${window.employer}`,
            date,
            kind: "renewal",
            source: "insurance",
            amountCents: null,
            href: "/insurance/benefits",
            detail: "Jane compares your benefits with buying the same cover yourself before it.",
          },
        ],
  );
};

// Every source, in one list.
export const DEADLINE_SOURCES: readonly DeadlineSource[] = [
  transactionDeadlines,
  loanDeadlines,
  handEnteredDeadlines,
  documentDeadlines,
  insuranceDeadlines,
  openEnrollmentDeadlines,
  workEnrollmentDeadlines,
  // Spec step 243: intro prices ending and yearly plans renewing.
  priceRiseDeadlines,
];

// Everything coming up, soonest first. A source that fails is left out (and logged) so
// the rest still show.
export async function listDeadlines(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    sources = DEADLINE_SOURCES,
  }: Options & { sources?: readonly DeadlineSource[] } = {},
): Promise<Deadline[]> {
  const results = await Promise.allSettled(
    sources.map((source) => source(userId, { client, now })),
  );
  const deadlines = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.error("Deadline source failed", { userId, index, error: String(result.reason) });
    return [];
  });
  return upcomingDeadlines(deadlines, isoDate(now));
}

// Raises a reminder for each deadline coming up soon. Each is raised once (its key), and
// the person's alert settings apply (raiseAlerts).
export async function remindDeadlines(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    raise = raiseAlerts,
    sources = DEADLINE_SOURCES,
  }: Options & { raise?: typeof raiseAlerts; sources?: readonly DeadlineSource[] } = {},
): Promise<number> {
  const alerts = deadlineAlerts(
    await listDeadlines(userId, { client, now, sources }),
    isoDate(now),
  );
  if (alerts.length === 0) return 0;
  const { raised } = await raise(userId, alerts, { client, now });
  return raised;
}

// The daily job: reminders for everyone with an account or a deadline of their own. Runs
// even without Plaid, since return windows and hand-entered dates move closer every day
// whether or not anything new synced.
export async function remindAllDeadlines({
  client = defaultClient,
  now = new Date(),
  remind = remindDeadlines,
  userIds,
}: Options & { remind?: typeof remindDeadlines } & OnlyPeople = {}): Promise<{
  users: number;
  raised: number;
  failed: number;
}> {
  // A system job across all users: it reads ids only, and remindDeadlines scopes each one.
  const users = await client.user.findMany({
    where: {
      deletedAt: null,
      OR: [{ accounts: { some: {} } }, { deadlines: { some: { doneAt: null } } }],
      ...peopleIn(userIds),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let raised = 0;
  let failed = 0;
  for (const user of users) {
    try {
      raised += await remind(user.id, { client, now });
    } catch (error) {
      failed += 1;
      console.error("Deadline reminders failed", { userId: user.id, error: String(error) });
    }
  }
  return { users: users.length, raised, failed };
}

// --- Hand-entered deadlines ----------------------------------------------------------

export const ENTERED_KINDS = ["fsa", "card_benefit", "warranty", "other"] as const;
export type EnteredKind = (typeof ENTERED_KINDS)[number];

export class DeadlineError extends Error {}

export type DeadlineForm = { title: string; dueOn: string; kind: string; note: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkedData(form: DeadlineForm, now: Date) {
  const title = form.title.trim().slice(0, DEADLINE_TITLE_MAX);
  if (!title) throw new DeadlineError("Say what the deadline is for.");
  const today = isoDate(now);
  const latest = `${Number(today.slice(0, 4)) + DEADLINE_MAX_YEARS_AHEAD}${today.slice(4)}`;
  if (!DATE.test(form.dueOn) || Number.isNaN(Date.parse(`${form.dueOn}T00:00:00Z`))) {
    throw new DeadlineError("Pick a date.");
  }
  if (form.dueOn < today) throw new DeadlineError("Pick today or a later date.");
  if (form.dueOn > latest) throw new DeadlineError("Pick a date in the next few years.");
  const kind = (ENTERED_KINDS as readonly string[]).includes(form.kind)
    ? (form.kind as EnteredKind)
    : "other";
  const note = form.note.trim().slice(0, DEADLINE_NOTE_MAX) || null;
  return { title, dueOn: new Date(`${form.dueOn}T00:00:00Z`), kind, note };
}

export async function addDeadline(
  userId: string,
  form: DeadlineForm,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const data = checkedData(form, now);
  await scopedFor(userId, client).deadlines.create({ data: { userId, ...data } });
  await track(userId, "deadline_added", { kind: data.kind });
}

export async function markDeadlineDone(
  userId: string,
  deadlineId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).deadlines.updateMany({
    where: { id: deadlineId, doneAt: null },
    data: { doneAt: now },
  });
  if (count > 0) await track(userId, "deadline_done", {});
  return count > 0;
}

export async function deleteDeadline(
  userId: string,
  deadlineId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).deadlines.deleteMany({
    where: { id: deadlineId },
  });
  if (count > 0) await track(userId, "deadline_deleted", {});
  return count > 0;
}
