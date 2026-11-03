import { CHAT_MONTHLY_CAP_CENTS_DEFAULT, CHAT_TRIAL_MONTH_SHARE } from "@/config/agent-chat";
import {
  STATEMENT_TRIAL_CAP_TEXT,
  STATEMENT_TRIAL_DAILY_CENTS_DEFAULT,
  STATEMENT_TRIAL_RESERVE_CENTS,
} from "@/config/statement-trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { DAY_MS } from "@/lib/dates";
import { db as defaultClient } from "@/lib/db";
import { giveBack, hit } from "@/lib/rate-limit";
import { systemDb } from "@/lib/system-db";
import { statementTrialEnabled } from "@/lib/statement-trial";
import { isStatementTrialUser, isTrialUser } from "@/lib/trial-ids";

// What Claude answering every typed message may cost (docs/spec.md, "Chat architecture"): a
// sample person's allowance of answers, and a monthly guard on all of Claude's chat spend.

type Options = { client?: PrismaClient; now?: Date };

export const TRIAL_CAP_TEXT =
  "You've used all 25 answers this sample account gets. Sign up to keep asking Jane about your own money.";

const MONTH_KEY = "chatmonth:total";
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const monthlyCapCents = () => {
  const set = Number(process.env.CHAT_MONTHLY_CAP_CENTS);
  return Number.isFinite(set) && set > 0 ? set : CHAT_MONTHLY_CAP_CENTS_DEFAULT;
};

// Adds one answer's cost (hundredths of a cent) to the month.
export async function addMonthlySpend(
  hundredthsOfCents: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (hundredthsOfCents <= 0) return;
  await systemDb("Rate limits are the system's own counters", client).$executeRaw`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${MONTH_KEY}, ${monthStart(now)}, ${hundredthsOfCents})
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + ${hundredthsOfCents}`;
}

export async function monthlySpentCents({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<number> {
  const row = await systemDb(
    "Rate limits are the system's own counters",
    client,
  ).rateLimit.findUnique({
    where: { key_windowStart: { key: MONTH_KEY, windowStart: monthStart(now) } },
    select: { count: true },
  });
  return (row?.count ?? 0) / 100;
}

// Why Claude may not be asked for this person's message, if it may not: the sample person's
// allowance is used up (a friendly written answer), or the month's spend is (the backup answer
// from the data). Counts the use when it is allowed.
export type ClaudeLimit = { text: string } | "budget" | null;

export async function claudeLimit(userId: string, options: Options = {}): Promise<ClaudeLimit> {
  const spent = await monthlySpentCents(options);
  if (spent >= monthlyCapCents()) return "budget";
  // Sample people stop early, so the rest of the month's budget is there for real people.
  if (isTrialUser(userId) && spent >= monthlyCapCents() * CHAT_TRIAL_MONTH_SHARE) return "budget";
  if (isStatementTrialUser(userId)) {
    // Turned off (TRY_STATEMENT): those still here get answers from their data, no Claude.
    if (!statementTrialEnabled()) return "budget";
    // The day's allowance for everyone first: an answer it refuses isn't counted against them.
    if (!(await reserveStatementTrialAnswer(options))) return "budget";
    if (!(await hit("claudeStatementTrial", userId, options)).ok) {
      await releaseStatementTrialAnswer(options);
      return { text: STATEMENT_TRIAL_CAP_TEXT };
    }
    return null;
  }
  if (isTrialUser(userId) && !(await hit("claudeTrial", userId, options)).ok) {
    return { text: TRIAL_CAP_TEXT };
  }
  return null;
}

// Claude didn't answer after all: the use isn't counted.
export async function refundClaudeUse(userId: string, options: Options = {}): Promise<void> {
  if (isStatementTrialUser(userId)) {
    await giveBack("claudeStatementTrial", userId, options).catch(() => {});
    return;
  }
  if (isTrialUser(userId)) await giveBack("claudeTrial", userId, options).catch(() => {});
}

// Claude has finished (or failed) for this message: what it cost is on the day's total by now
// (addSpend), so the amount held back for it goes back. Only a temporary try holds any.
export async function claudeFinished(userId: string, options: Options = {}): Promise<void> {
  if (isStatementTrialUser(userId)) await releaseStatementTrialAnswer(options).catch(() => {});
}

// All temporary people's Claude spend today, in the same hundredths of a cent as the month's, with
// the holds of answers being written. One counter, so two answers at once see each other.
const STATEMENT_DAY_KEY = "statementtrial:claude";
const STATEMENT_DAY_WHY = "One counter for everyone trying Jane with their own statement";
const dayStart = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
const RESERVE = STATEMENT_TRIAL_RESERVE_CENTS * 100;

export const statementTrialDailyCents = () => {
  const set = process.env.STATEMENT_TRIAL_DAILY_CENTS;
  const cents = set === undefined || set === "" ? Number.NaN : Number(set);
  return Number.isFinite(cents) && cents >= 0 ? cents : STATEMENT_TRIAL_DAILY_CENTS_DEFAULT;
};

async function addToDay(
  amount: number,
  { client = defaultClient, now = new Date() }: Options,
): Promise<number> {
  const [row] = await systemDb(STATEMENT_DAY_WHY, client).$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${STATEMENT_DAY_KEY}, ${dayStart(now)}, GREATEST(${amount}, 0))
    ON CONFLICT (key, window_start) DO UPDATE SET count = GREATEST(rate_limits.count + ${amount}, 0)
    RETURNING count`;
  return Number(row.count);
}

export const addStatementTrialSpend = (hundredths: number, options: Options = {}) =>
  addToDay(hundredths, options).then(() => undefined);

async function reserveStatementTrialAnswer(options: Options): Promise<boolean> {
  if ((await addToDay(RESERVE, options)) <= statementTrialDailyCents() * 100) return true;
  await releaseStatementTrialAnswer(options);
  return false;
}

async function releaseStatementTrialAnswer(options: Options): Promise<void> {
  await addToDay(-RESERVE, options);
}

export async function statementTrialSpentCents({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<number> {
  const row = await systemDb(STATEMENT_DAY_WHY, client).rateLimit.findUnique({
    where: { key_windowStart: { key: STATEMENT_DAY_KEY, windowStart: dayStart(now) } },
    select: { count: true },
  });
  return (row?.count ?? 0) / 100;
}
