import Anthropic from "@anthropic-ai/sdk";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { backgroundSpentCents, holdFor, meteredClaude } from "./claude-budget";
import { monthlySpentCents } from "./jane-agent/claude-limits";
import { costInHundredthsOfCents } from "./jane-agent/spend";

// Calls at once, against a real Postgres: the cap used to be read before a call and charged after
// it, so 20 uploads at once all passed the 50 cents a day that two of them would have reached.

const url = process.env.TEST_DATABASE_URL;
// A day of its own, so nothing else in the shared database touches the month's counter.
const NOW = new Date("2031-03-15T12:00:00Z");
const MODEL = "claude-sonnet-5-5";

const file = {
  model: MODEL,
  max_tokens: 1000,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: "QUJD" },
        },
        { type: "text", text: "Read this." },
      ],
    },
  ],
} as Anthropic.MessageCreateParamsNonStreaming;
const words = {
  model: MODEL,
  max_tokens: 200,
  messages: [{ role: "user", content: "Say it plainly." }],
} as Anthropic.MessageCreateParamsNonStreaming;

describe.runIf(url)("what Claude may cost, when calls come at once", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterEach(async () => {
    await client.rateLimit.deleteMany({
      where: { windowStart: { gte: new Date("2031-03-01"), lt: new Date("2031-04-01") } },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  async function person() {
    const { id } = await client.user.create({
      data: { email: `at-once-${crypto.randomUUID()}@example.com` },
    });
    made.push(id);
    return id;
  }

  // Claude answers after a moment, with what a long PDF costs, or fails.
  function fakeClaude(behave: () => Promise<Anthropic.Usage> | Anthropic.Usage) {
    const create = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { content: [], usage: await behave() };
    });
    return { create, claude: (() => ({ messages: { create } })) as never };
  }
  const usage = (input: number) => ({ input_tokens: input, output_tokens: 100 }) as Anthropic.Usage;

  it("stops a burst of files at the day's cap", async () => {
    const userId = await person();
    const { create, claude } = fakeClaude(() => usage(90_000));
    const metered = meteredClaude(userId, { client, now: NOW, claude })();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => metered.messages.create(file)),
    );
    expect(create.mock.calls.length).toBe(2);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(18);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as { status: number }).status).toBe(429);
  });

  it("charges what the calls cost, and lets go of what it held", async () => {
    const userId = await person();
    const { create, claude } = fakeClaude(() => usage(1_000));
    const metered = meteredClaude(userId, { client, now: NOW, claude })();
    await Promise.all(Array.from({ length: 5 }, () => metered.messages.create(words)));
    expect(create).toHaveBeenCalledTimes(5);
    const { today, month } = await backgroundSpentCents(userId, { client, now: NOW });
    const one = costInHundredthsOfCents({
      model: MODEL,
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(today).toBeCloseTo((5 * one) / 100, 1);
    expect(month).toBe(today);
    expect(await monthlySpentCents({ client, now: NOW })).toBe(today);
  });

  it("lets a first scan's many small calls through together", async () => {
    const userId = await person();
    const { create, claude } = fakeClaude(() => usage(500));
    const metered = meteredClaude(userId, { client, now: NOW, claude })();
    await Promise.all(Array.from({ length: 30 }, () => metered.messages.create(words)));
    expect(create).toHaveBeenCalledTimes(30);
  });

  it("gives the hold back when Claude fails, so the next call may run", async () => {
    const userId = await person();
    const { claude } = fakeClaude(() => {
      throw new Error("overloaded");
    });
    const metered = meteredClaude(userId, { client, now: NOW, claude })();
    await expect(metered.messages.create(file)).rejects.toThrow("overloaded");
    expect((await backgroundSpentCents(userId, { client, now: NOW })).today).toBe(0);
    expect(await monthlySpentCents({ client, now: NOW })).toBe(0);
  });

  it("holds the month's total for everyone, whoever's asking", async () => {
    const people = await Promise.all(Array.from({ length: 6 }, () => person()));
    await client.rateLimit.create({
      data: {
        key: "chatmonth:total",
        windowStart: new Date("2031-03-01T00:00:00Z"),
        count: 799 * 100,
      },
    });
    const { create, claude } = fakeClaude(() => usage(90_000));
    await Promise.allSettled(
      people.map((userId) =>
        meteredClaude(userId, { client, now: NOW, claude })().messages.create(file),
      ),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("holds more for a file than for words, whatever the file's bytes", () => {
    const small = holdFor(file);
    const big = holdFor({
      ...file,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: "Q".repeat(5_000_000),
              },
            },
            { type: "text", text: "Read this." },
          ],
        },
      ],
    });
    expect(big).toBe(small);
    expect(small).toBeGreaterThanOrEqual(25 * 100);
    expect(holdFor(words)).toBeLessThan(100);
  });
});
