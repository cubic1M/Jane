import {
  DEADLINE_MAX_YEARS_AHEAD,
  DEADLINE_NOTE_MAX,
  DEADLINE_TITLE_MAX,
} from "@/config/deadlines";
import { loadDetectionInput } from "@/detection/engine";
import { buildStreams } from "@/detection/streams";
import { isoDate } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  deadlineAlerts,
  enteredDeadlines,
  paymentDeadlines,
  renewalDeadlines,
  returnDeadlines,
  trialDeadlines,
  upcomingDeadlines,
  type Deadline,
} from "@/insights/deadlines";
import { raiseAlerts } from "@/lib/alerts";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Deadlines (spec step 71): loads each source's data, keeps the deadlines the person types
// in, and raises the deadline_soon reminders (src/insights/deadlines.ts decides which).

type Options = { client?: PrismaClient; now?: Date };

export type SourceOptions = { client: PrismaClient; now: Date };

// One place deadlines come from. Each gets the person's id and returns their deadlines.
export type DeadlineSource = (userId: string, options: SourceOptions) => Promise<Deadline[]>;

// Renewals, trials and return windows, from the transactions.
export const transactionDeadlines: DeadlineSource = async (userId, { client, now }) => {
  const [input, confirmed] = await Promise.all([
    loadDetectionInput(userId, { client, now }),
    scopedFor(userId, client).subscriptionChecks.findMany({
      where: { isSubscription: true },
      select: { merchantKey: true },
    }),
  ]);
  input.subscriptionMerchantKeys = confirmed.map((c) => c.merchantKey);
  const streams = buildStreams(input);
  return [
    ...renewalDeadlines(input, streams),
    ...trialDeadlines(input),
    ...returnDeadlines(input, streams),
  ];
};

// Card and loan due dates the bank reports (spec step 65).
export const loanDeadlines: DeadlineSource = async (userId, { client, now }) => {
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: { type: { in: ["credit", "loan"] } },
    select: {
      id: true,
      name: true,
      mask: true,
      type: true,
      subtype: true,
      currentBalanceCents: true,
      liability: {
        select: {
          aprBps: true,
          rateType: true,
          minimumPaymentCents: true,
          nextPaymentDueDate: true,
          payoffDate: true,
          isOverdue: true,
          pastDueCents: true,
          ytdInterestPaidCents: true,
          description: true,
        },
      },
    },
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

// Dates read from uploaded policies, warranties and receipts (spec step 68). That step
// isn't merged yet, so this has nothing to add; it becomes a call to its documentDates
// once it is.
export const documentDeadlines: DeadlineSource = async () => [];

// Every source, in one list.
export const DEADLINE_SOURCES: readonly DeadlineSource[] = [
  transactionDeadlines,
  loanDeadlines,
  handEnteredDeadlines,
  documentDeadlines,
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
}: Options & { remind?: typeof remindDeadlines } = {}): Promise<{
  users: number;
  raised: number;
  failed: number;
}> {
  // A system job across all users: it reads ids only, and remindDeadlines scopes each one.
  const users = await client.user.findMany({
    where: {
      deletedAt: null,
      OR: [{ accounts: { some: {} } }, { deadlines: { some: { doneAt: null } } }],
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
