import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { RATE_LIMITS, RATE_LIMIT_RETENTION_HOURS, type LimitName } from "@/config/rate-limits";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// Fixed-window rate limiting in Postgres, so it holds across serverless instances
// without another service. One atomic upsert per request.

export type RateResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

type Options = { client?: PrismaClient; now?: Date };

export async function hit(
  name: LimitName,
  subject: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RateResult> {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${name}:${subject}`;

  const [row] = await client.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  const count = Number(row.count);

  // Now and then, clear out old windows.
  if (count === 1 && Math.random() < 0.01) {
    const cutoff = new Date(now.getTime() - RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000);
    await client.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
  }
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
  };
}

// Gives back one use in the current window, for a request that didn't cost what the limit
// protects (Claude failed or was too slow, so the rules answered): it shouldn't count.
export async function giveBack(
  name: LimitName,
  subject: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const windowMs = RATE_LIMITS[name].windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  await client.$executeRaw`
    UPDATE rate_limits SET count = GREATEST(count - 1, 0)
    WHERE key = ${`${name}:${subject}`} AND window_start = ${windowStart}`;
}

// A stable, non-reversible id for the caller's IP (first X-Forwarded-For hop on Vercel).
export function ipKey(headers: Headers): string {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 32);
}

export function tooManyRequests(result: RateResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

// For route handlers: null when allowed, else the 429 response to return.
export async function limitOrNull(name: LimitName, subject: string): Promise<NextResponse | null> {
  const result = await hit(name, subject);
  return result.ok ? null : tooManyRequests(result);
}
