import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { RATE_LIMITS } from "../src/config/rate-limits";

// The proxy's rate limits (src/lib/edge-limits.ts, docs/security/edge.md): past the limit an
// API route answers a calm 429 with when to come back, and nothing behind it runs. Each test
// claims its own made-up IP (Vercel sets X-Forwarded-For; locally the test does), so the
// counters start at zero and no other test shares them.

// A window starts on the minute (src/lib/rate-limit.ts), so a burst that crosses one is counted in
// two and never reaches its limit. A real break fails every try.
test.setTimeout(120_000);
const PAST_A_WINDOW = { timeout: 90_000, intervals: [1_000] };

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
  const { limit } = RATE_LIMITS.api;
  let headers = {};
  let refused!: APIResponse;
  await expect(async () => {
    headers = { "x-forwarded-for": freshIp() };
    const statuses = await burst(request, limit, async () => {
      const response = await request.get("/api/health", { headers });
      return response.status();
    });
    expect(statuses.filter((s) => s === 200)).toHaveLength(limit);

    refused = await request.get("/api/health", { headers });
    expect(refused.status()).toBe(429);
  }).toPass(PAST_A_WINDOW);
  expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  expect(await refused.json()).toEqual({
    error: "Too many requests. Please wait a moment and try again.",
  });
  // The refusal still carries the security headers.
  expect(refused.headers()["x-content-type-options"]).toBe("nosniff");

  // Someone else's IP is unaffected.
  expect(
    (await request.get("/api/health", { headers: { "x-forwarded-for": freshIp() } })).status(),
  ).toBe(200);

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
  const { limit } = RATE_LIMITS.trialActions;
  let refused!: APIResponse;
  await expect(async () => {
    const headers = { cookie, "next-action": "0".repeat(42), "x-forwarded-for": freshIp() };
    const statuses = await burst(request, limit, async () => {
      const response = await request.post("/", { headers, data: "[]" });
      return response.status();
    });
    expect(statuses).not.toContain(429);

    refused = await request.post("/", { headers, data: "[]" });
    expect(refused.status()).toBe(429);
  }).toPass(PAST_A_WINDOW);
  expect(refused.headers()["content-type"]).toBe("text/plain");
  expect(await refused.text()).toBe("Too many requests. Please wait a moment and try again.");
});
