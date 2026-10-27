import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  KEEP_RATE_LIMIT_PREFIXES,
  RATE_LIMITS,
  RATE_LIMIT_RETENTION_HOURS,
  type LimitName,
} from "@/config/rate-limits";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// Fixed-window rate limiting in Postgres, so it holds across serverless instances
// without another service. One atomic upsert per request.

export type RateResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

type Options = { client?: PrismaClient; now?: Date };

// The window a request falls in, and its counter's key.
function windowFor(name: LimitName, subject: string, now: Date) {
  const windowMs = RATE_LIMITS[name].windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  return { key: `${name}:${subject}`, windowStart, windowMs };
}

function resultFor(name: LimitName, count: number, windowStart: Date, now: Date): RateResult {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.ceil(
      (windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000,
    ),
  };
}

// Now and then, clear out old windows: never on the caller's wait (a delete that scans the
// table once cost one visitor a second on the click).
function sometimesCleanUp(client: PrismaClient, now: Date) {
  if (Math.random() >= 0.01) return;
  const cutoff = new Date(now.getTime() - RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000);
  void client.rateLimit
    .deleteMany({
      where: {
        windowStart: { lt: cutoff },
        NOT: KEEP_RATE_LIMIT_PREFIXES.map((prefix) => ({ key: { startsWith: prefix } })),
      },
    })
    .catch(() => undefined);
}

export async function hit(
  name: LimitName,
  subject: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RateResult> {
  const { key, windowStart } = windowFor(name, subject, now);
  const [row] = await client.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  const count = Number(row.count);
  if (count === 1) sometimesCleanUp(client, now);
  return resultFor(name, count, windowStart, now);
}

export type Check = { name: LimitName; subject: string };

// Several limits in one round trip (the proxy's backstops, src/lib/edge-limits.ts): every
// counter goes up, and the request is allowed only if all of them allow it.
export async function hitMany(
  checks: Check[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RateResult> {
  const windows = new Map(
    checks.map((c) => {
      const w = windowFor(c.name, c.subject, now);
      return [w.key, { ...w, name: c.name }];
    }),
  );
  if (windows.size === 0) return { ok: true, remaining: Infinity, retryAfterSeconds: 0 };
  const values = Prisma.join(
    [...windows.values()].map((w) => Prisma.sql`(${w.key}, ${w.windowStart}, 1)`),
  );
  const rows = await client.$queryRaw<{ key: string; count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES ${values}
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING key, count`;
  if (rows.some((r) => Number(r.count) === 1)) sometimesCleanUp(client, now);
  const results = rows.map((r) => {
    const w = windows.get(r.key)!;
    return resultFor(w.name, Number(r.count), w.windowStart, now);
  });
  const refused = results.filter((r) => !r.ok);
  return {
    ok: refused.length === 0,
    remaining: Math.min(...results.map((r) => r.remaining)),
    retryAfterSeconds: Math.max(0, ...refused.map((r) => r.retryAfterSeconds)),
  };
}

// Gives back one use in the current window, for a request that didn't cost what the limit
// protects (Claude failed or was too slow, so the rules answered): it shouldn't count.
export async function giveBack(
  name: LimitName,
  subject: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { key, windowStart } = windowFor(name, subject, now);
  await client.$executeRaw`
    UPDATE rate_limits SET count = GREATEST(count - 1, 0)
    WHERE key = ${key} AND window_start = ${windowStart}`;
}

// The caller's IP as Vercel gives it (the first X-Forwarded-For hop, which Vercel sets
// itself), or null when there's none (local runs).
export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

// A stable, non-reversible id for the caller's IP, for counters.
export function ipKey(headers: Headers): string {
  const ip = clientIp(headers) ?? "unknown";
  return createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 32);
}

// The calm words every refusal uses.
export const TOO_MANY_MESSAGE = "Too many requests. Please wait a moment and try again.";

export function tooManyRequests(result: RateResult): NextResponse {
  return NextResponse.json(
    { error: TOO_MANY_MESSAGE },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

// For route handlers: null when allowed, else the 429 response to return.
export async function limitOrNull(name: LimitName, subject: string): Promise<NextResponse | null> {
  const result = await hit(name, subject);
  return result.ok ? null : tooManyRequests(result);
}
