import { addMonthlySpend } from "./claude-limits";
import { CHAT_CLAUDE_DAILY_CAP_CENTS } from "@/config/agent-chat";
import { MODEL_PRICES_CENTS } from "@/config/answer-checks";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// What Claude has cost for one person today (spec step 191): a daily cap, kept in the
// rate_limits table (one counter per person per day, in hundredths of a cent), so it holds
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
const keyOf = (userId: string) => `chatspend:${userId}`;
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

export async function overDailyCap(userId: string, options: Options = {}): Promise<boolean> {
  return (await spentTodayCents(userId, options)) >= CHAT_CLAUDE_DAILY_CAP_CENTS;
}
