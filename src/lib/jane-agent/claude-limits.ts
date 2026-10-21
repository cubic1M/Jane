import { CHAT_MONTHLY_CAP_CENTS_DEFAULT } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { giveBack, hit } from "@/lib/rate-limit";
import { isTrialUser } from "@/lib/trial-ids";

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
  await client.$executeRaw`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${MONTH_KEY}, ${monthStart(now)}, ${hundredthsOfCents})
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + ${hundredthsOfCents}`;
}

export async function monthlySpentCents({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<number> {
  const row = await client.rateLimit.findUnique({
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
  if ((await monthlySpentCents(options)) >= monthlyCapCents()) return "budget";
  if (isTrialUser(userId) && !(await hit("claudeTrial", userId, options)).ok) {
    return { text: TRIAL_CAP_TEXT };
  }
  return null;
}

// Claude didn't answer after all: the use isn't counted.
export async function refundClaudeUse(userId: string, options: Options = {}): Promise<void> {
  if (isTrialUser(userId)) await giveBack("claudeTrial", userId, options).catch(() => {});
}
