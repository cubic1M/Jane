import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_BACKGROUND_DAILY_CAP_CENTS,
  CLAUDE_BACKGROUND_MONTHLY_CAP_CENTS,
} from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { isAdminEmail } from "@/lib/invites";
import { log } from "@/lib/log";
import {
  addMonthlySpend,
  monthlyCapCents,
  monthlySpentCents,
} from "@/lib/jane-agent/claude-limits";
import { costInHundredthsOfCents } from "@/lib/jane-agent/spend";
import { isTrialUser } from "@/lib/trial-ids";
import { DAY_MS } from "@/lib/dates";

// What Claude may cost for one person outside the chat (plan item 13): reading an upload, writing
// a card's words, sorting merchants, drafting a message. Uploads and statements are what a person
// controls, so nobody can run up the bill with them. A counter per person per UTC day and month,
// apart from the chat's, so a first scan doesn't use up their answers; both count toward the
// month's total for all of Claude, which stops these too.
//
// meteredClaude is what these paths are handed in place of anthropic. Past a limit it answers like
// a busy API (a 429), which each of them already handles by falling back to its template or rules,
// and Claude isn't called. src/lib/claude-paths.test.ts fails on a path that isn't listed.

type Options = { client?: PrismaClient; now?: Date };

// A web search on find-contact's tool costs a cent, on top of its tokens.
const WEB_SEARCH_HUNDREDTHS = 100;

const dayKey = (userId: string) => `claudebg:${userId}`;
const monthKey = (userId: string) => `claudebgmonth:${userId}`;
const dayStart = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

async function counted(client: PrismaClient, key: string, windowStart: Date): Promise<number> {
  const row = await client.rateLimit.findUnique({
    where: { key_windowStart: { key, windowStart } },
    select: { count: true },
  });
  return (row?.count ?? 0) / 100;
}

export async function backgroundSpentCents(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ today: number; month: number }> {
  const [today, month] = await Promise.all([
    counted(client, dayKey(userId), dayStart(now)),
    counted(client, monthKey(userId), monthStart(now)),
  ]);
  return { today, month };
}

// Whether Claude may be asked for this person now. An admin has no limit of their own, as in the
// chat; the month's total still holds for everyone.
export async function backgroundCapHit(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  if ((await monthlySpentCents({ client, now })) >= monthlyCapCents()) return true;
  const { today, month } = await backgroundSpentCents(userId, { client, now });
  // Whatever a caller forgot: a sample person's background work never reaches Claude (src/lib/trial.ts).
  if (isTrialUser(userId)) return true;
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  });
  if (user?.role === "admin" || (user?.email && isAdminEmail(user.email))) return false;
  return today >= CLAUDE_BACKGROUND_DAILY_CAP_CENTS || month >= CLAUDE_BACKGROUND_MONTHLY_CAP_CENTS;
}

export async function chargeBackground(
  userId: string,
  model: string,
  usage: Anthropic.Usage | undefined,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const amount =
    costInHundredthsOfCents({
      model,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    }) +
    (usage?.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_HUNDREDTHS;
  if (amount <= 0) return;
  for (const [key, windowStart] of [
    [dayKey(userId), dayStart(now)],
    [monthKey(userId), monthStart(now)],
  ] as const) {
    await client.$executeRaw`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, ${amount})
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + ${amount}`;
  }
  await addMonthlySpend(amount, { client, now });
}

const capped = () => new Anthropic.APIError(429, { type: "error" }, "person_budget", new Headers());

// `anthropic`, for one person: the same create, inside their limits. Anything going wrong with the
// count itself means Claude isn't asked; a charge that fails to save is logged and the answer kept.
export function meteredClaude(
  userId: string,
  { client = defaultClient, now, claude = anthropic }: Options & { claude?: typeof anthropic } = {},
): typeof anthropic {
  return (() => ({
    messages: {
      create: async (...args: Parameters<Anthropic["messages"]["create"]>) => {
        const at = now ?? new Date();
        const blocked = await backgroundCapHit(userId, { client, now: at }).catch(() => true);
        if (blocked) throw capped();
        const response = (await claude().messages.create(...args)) as Anthropic.Message;
        await chargeBackground(userId, args[0].model, response.usage, { client, now: at }).catch(
          (error: unknown) => log.error("Claude budget: charge failed", { error: String(error) }),
        );
        return response;
      },
    },
  })) as unknown as typeof anthropic;
}
