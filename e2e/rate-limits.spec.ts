import { expect, test, type APIRequestContext } from "@playwright/test";
import { RATE_LIMITS } from "../src/config/rate-limits";

// The proxy's rate limits (src/lib/edge-limits.ts, docs/security/edge.md): past the limit an
// API route answers a calm 429 with when to come back, and nothing behind it runs. Each test
// claims its own made-up IP (Vercel sets X-Forwarded-For; locally the test does), so the
// counters start at zero and no other test shares them.

const freshIp = () =>
  `198.51.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;

async function burst(request: APIRequestContext, count: number, send: () => Promise<number>) {
  const statuses: number[] = [];
  // In batches, so the run doesn't open hundreds of connections at once.
  for (let done = 0; done < count; done += 50) {
    const batch = Array.from({ length: Math.min(50, count - done) }, send);
    statuses.push(...(await Promise.all(batch)));
  }
  return statuses;
}

test("an API route answers 429 past its limit, calmly, and cron routes aren't limited", async ({
  request,
}) => {
  const ip = freshIp();
  const headers = { "x-forwarded-for": ip };
  const { limit } = RATE_LIMITS.api;

  const statuses = await burst(request, limit, async () => {
    const response = await request.get("/api/health", { headers });
    return response.status();
  });
  expect(statuses.filter((s) => s === 200)).toHaveLength(limit);

  const refused = await request.get("/api/health", { headers });
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  expect(await refused.json()).toEqual({
    error: "Too many requests. Please wait a moment and try again.",
  });
  // The refusal still carries the security headers.
  expect(refused.headers()["x-content-type-options"]).toBe("nosniff");

  // Someone else's IP is unaffected.
  expect((await request.get("/api/health", { headers: { "x-forwarded-for": freshIp() } })).status()).toBe(200);

  // Cron routes check CRON_SECRET instead: the same IP gets "unauthorized", not 429.
  const cron = await request.get("/api/cron/digest", { headers });
  expect(cron.status()).toBe(401);
});

test("a session past its server-action limit gets a plain-text 429 the page can show", async ({
  request,
}) => {
  // A Try Jane-shaped session: its own, tighter limit. The proxy counts it before anything
  // looks the session or the action up, so neither needs to exist.
  const cookie = `authjs.session-token=trial_${crypto.randomUUID().replaceAll("-", "")}`;
  const headers = { cookie, "next-action": "0".repeat(42), "x-forwarded-for": freshIp() };
  const { limit } = RATE_LIMITS.trialActions;

  const statuses = await burst(request, limit, async () => {
    const response = await request.post("/", { headers, data: "[]" });
    return response.status();
  });
  expect(statuses).not.toContain(429);

  const refused = await request.post("/", { headers, data: "[]" });
  expect(refused.status()).toBe(429);
  expect(refused.headers()["content-type"]).toBe("text/plain");
  expect(await refused.text()).toBe("Too many requests. Please wait a moment and try again.");
});
