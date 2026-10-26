import { addMonthlySpend, monthlyCapCents, monthlySpentCents } from "./claude-limits";
import { CHAT_PERSON_DAILY_CAP_CENTS, CHAT_TRIAL_DAILY_CAP_CENTS } from "@/config/agent-chat";
import { MODEL_PRICES_CENTS } from "@/config/answer-checks";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { isAdminEmail } from "@/lib/invites";
import { isTrialUser } from "@/lib/trial-ids";

// What Claude has cost for one person today (spec step 191): a daily cap, kept in the
// rate_limits table (one counter per person per UTC day, in hundredths of a cent), so it holds
// across serverless instances. Past the cap Claude isn't asked and the rules answer.

type Options = { client?: PrismaClient; now?: Date };
export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

const DAY_MS = 86_400_000;
const SPEND_PREFIX = "chatspend:";
const HIT_PREFIX = "chatcaphit:";
const keyOf = (userId: string) => `${SPEND_PREFIX}${userId}`;
const dayStart = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);

// Cents ×100 for one call at the listed price (the dearest listed price for a model that
// isn't listed, so the cap never undercounts). Cached input is billed at a tenth, writing
// the cache at one and a quarter times.
export function costInHundredthsOfCents(usage: Usage): number {
  const prices = Object.values(MODEL_PRICES_CENTS);
  const price = MODEL_PRICES_CENTS[usage.model] ?? {
    input: Math.max(...prices.map((p) => p.input)),
    output: Math.max(...prices.map((p) => p.output)),
  };
  // price is cents per million tokens; ×100 for hundredths, ÷1e6 for tokens.
  const perToken = (cents: number) => (cents * 100) / 1_000_000;
  return Math.ceil(
    usage.inputTokens * perToken(price.input) +
      (usage.cacheReadTokens ?? 0) * perToken(price.input) * 0.1 +
      (usage.cacheWriteTokens ?? 0) * perToken(price.input) * 1.25 +
      usage.outputTokens * perToken(price.output),
  );
}

export async function addSpend(
  userId: string,
  usage: Usage,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const amount = costInHundredthsOfCents(usage);
  if (amount <= 0) return;
  await client.$executeRaw`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${keyOf(userId)}, ${dayStart(now)}, ${amount})
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + ${amount}`;
  // And the month's total, which guards all of Claude's chat spend together.
  await addMonthlySpend(amount, { client, now });
}

export async function spentTodayCents(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const row = await client.rateLimit.findUnique({
    where: { key_windowStart: { key: keyOf(userId), windowStart: dayStart(now) } },
    select: { count: true },
  });
  return (row?.count ?? 0) / 100;
}

// This person's allowance a day, in cents (founder, 2026-10-26: one person can't use up the
// month): a sample person's own, everyone else's the same, and none for an admin (ADMIN_EMAILS).
export async function dailyCapCents(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<number | null> {
  if (isTrialUser(userId)) return CHAT_TRIAL_DAILY_CAP_CENTS;
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  });
  if (user?.role === "admin" || (user?.email && isAdminEmail(user.email))) return null;
  return CHAT_PERSON_DAILY_CAP_CENTS;
}

export async function overDailyCap(userId: string, options: Options = {}): Promise<boolean> {
  const cap = await dailyCapCents(userId, options);
  return cap !== null && (await spentTodayCents(userId, options)) >= cap;
}

// A message that met the person's daily limit, for the founder's count on /admin/chat. Sample
// people are sample data, never counted.
export async function recordLimitHit(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (isTrialUser(userId)) return;
  await client.$executeRaw`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${HIT_PREFIX + userId}, ${dayStart(now)}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1`;
}

export type SpendToday = {
  // What Claude's written answers cost today, everyone's (sample accounts' part apart).
  spentCents: number;
  sampleCents: number;
  // Real people Claude wrote for today, and those who met their limit (and how often).
  people: number;
  peopleAtLimit: number;
  limitHits: number;
  personCapCents: number;
  monthSpentCents: number;
  monthCapCents: number;
};

// Today's chat spend and limit hits, across everyone, for the founder (/admin/chat). Counts
// and cents only, never who.
export async function spendToday({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<SpendToday> {
  const [rows, monthSpentCents] = await Promise.all([
    client.rateLimit.findMany({
      where: {
        windowStart: dayStart(now),
        OR: [{ key: { startsWith: SPEND_PREFIX } }, { key: { startsWith: HIT_PREFIX } }],
      },
      select: { key: true, count: true },
    }),
    monthlySpentCents({ client, now }),
  ]);
  const today: SpendToday = {
    spentCents: 0,
    sampleCents: 0,
    people: 0,
    peopleAtLimit: 0,
    limitHits: 0,
    personCapCents: CHAT_PERSON_DAILY_CAP_CENTS,
    monthSpentCents,
    monthCapCents: monthlyCapCents(),
  };
  for (const { key, count } of rows) {
    if (key.startsWith(HIT_PREFIX)) {
      today.peopleAtLimit += 1;
      today.limitHits += count;
      continue;
    }
    today.spentCents += count / 100;
    if (isTrialUser(key.slice(SPEND_PREFIX.length))) today.sampleCents += count / 100;
    else today.people += 1;
  }
  return today;
}
