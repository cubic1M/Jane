import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_ATTACHMENT_HOLD_CENTS,
  CLAUDE_BACKGROUND_DAILY_CAP_CENTS,
  CLAUDE_BACKGROUND_MONTHLY_CAP_CENTS,
} from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { stillAnAdmin } from "@/lib/admin-emails";
import { isAdminEmail } from "@/lib/invites";
import { log } from "@/lib/log";
import {
  addMonthlySpend,
  monthCounter,
  monthlyCapCents,
  monthlySpentCents,
} from "@/lib/jane-agent/claude-limits";
import { costInHundredthsOfCents } from "@/lib/jane-agent/spend";
import { isTrialUser } from "@/lib/trial-ids";
import { dayStartUtc, monthStartUtc } from "@/lib/dates";
import { systemDb } from "@/lib/system-db";
import { scopedFor } from "@/lib/db-scoped";

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

async function counted(client: PrismaClient, key: string, windowStart: Date): Promise<number> {
  const row = await systemDb(
    "Rate limits are the system's own counters",
    client,
  ).rateLimit.findUnique({
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
    counted(client, dayKey(userId), dayStartUtc(now)),
    counted(client, monthKey(userId), monthStartUtc(now)),
  ]);
  return { today, month };
}

// An admin has no limit of their own, as in the chat. Someone taken off ADMIN_EMAILS keeps their role
// until they next sign in: not the allowance.
async function hasNoOwnLimit(userId: string, client: PrismaClient): Promise<boolean> {
  const user = await scopedFor(userId, client).me.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  });
  return Boolean(
    (user?.role === "admin" && stillAnAdmin(user.email)) ||
    (user?.email && isAdminEmail(user.email)),
  );
}

// Whether Claude may be asked for this person now. The month's total holds for everyone.
export async function backgroundCapHit(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  if ((await monthlySpentCents({ client, now })) >= monthlyCapCents()) return true;
  const { today, month } = await backgroundSpentCents(userId, { client, now });
  // Whatever a caller forgot: a sample person's background work never reaches Claude (src/lib/trial.ts).
  if (isTrialUser(userId)) return true;
  if (await hasNoOwnLimit(userId, client)) return false;
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
    [dayKey(userId), dayStartUtc(now)],
    [monthKey(userId), monthStartUtc(now)],
  ] as const) {
    await systemDb("Rate limits are the system's own counters", client).$executeRaw`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, ${amount})
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + ${amount}`;
  }
  await addMonthlySpend(amount, { client, now });
}

const capped = () => new Anthropic.APIError(429, { type: "error" }, "person_budget", new Headers());

type Counter = { key: string; windowStart: Date; capCents: number };

// What a call may cost before its real cost is known, in hundredths of a cent: its words at about
// four characters a token, all of its answer, and a set amount for each file, whose bytes don't say.
export function holdFor(params: Anthropic.MessageCreateParams): number {
  const { model, max_tokens: outputTokens, ...rest } = params;
  let files = 0;
  const words = JSON.stringify(rest, (_key, value: { type?: unknown } | null) => {
    if (value?.type !== "document" && value?.type !== "image") return value;
    files += 1;
    return undefined;
  });
  return (
    costInHundredthsOfCents({
      model,
      inputTokens: Math.ceil(words.length / 4),
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }) +
    files * CLAUDE_ATTACHMENT_HOLD_CENTS * 100
  );
}

async function letGo(counters: readonly Counter[], amount: number, client: PrismaClient) {
  for (const { key, windowStart } of counters) {
    await systemDb("Rate limits are the system's own counters", client).$executeRaw`
      UPDATE rate_limits SET count = GREATEST(count - ${amount}, 0)
      WHERE key = ${key} AND window_start = ${windowStart}`;
  }
}

// Holds the amount on every counter, or on none. The cap is read and the amount added in one
// statement, so calls at once see each other: charging only afterwards let 20 uploads at once all
// pass a cap the first two would have reached. As before, a call under the cap may run over it.
async function holdOn(counters: readonly Counter[], amount: number, client: PrismaClient) {
  const held: Counter[] = [];
  for (const counter of counters) {
    const { key, windowStart, capCents } = counter;
    const rows = await systemDb("Rate limits are the system's own counters", client).$queryRaw<
      unknown[]
    >`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, ${amount})
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + ${amount}
      WHERE rate_limits.count < ${capCents * 100}
      RETURNING count`;
    if (rows.length === 0) {
      await letGo(held, amount, client);
      return false;
    }
    held.push(counter);
  }
  return true;
}

async function countersFor(userId: string, client: PrismaClient, now: Date): Promise<Counter[]> {
  const month = monthCounter(now);
  if (await hasNoOwnLimit(userId, client)) return [month];
  return [
    month,
    {
      key: dayKey(userId),
      windowStart: dayStartUtc(now),
      capCents: CLAUDE_BACKGROUND_DAILY_CAP_CENTS,
    },
    {
      key: monthKey(userId),
      windowStart: monthStartUtc(now),
      capCents: CLAUDE_BACKGROUND_MONTHLY_CAP_CENTS,
    },
  ];
}

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
        const hold = holdFor(args[0]);
        const counters = await countersFor(userId, client, at).catch(() => null);
        const held = counters !== null && (await holdOn(counters, hold, client).catch(() => false));
        if (!counters || !held) throw capped();
        try {
          const response = (await claude().messages.create(...args)) as Anthropic.Message;
          await chargeBackground(userId, args[0].model, response.usage, { client, now: at }).catch(
            (error: unknown) => log.error("Claude budget: charge failed", { error: String(error) }),
          );
          return response;
        } finally {
          // Left held if this fails: the person's day ends a little early, which is the safe side.
          await letGo(counters, hold, client).catch((error: unknown) =>
            log.error("Claude budget: hold not released", { error: String(error) }),
          );
        }
      },
    },
  })) as unknown as typeof anthropic;
}
