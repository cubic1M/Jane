import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STRATEGIST_CAPABILITY } from "@/config/strategist";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addSpend } from "@/lib/jane-agent/spend";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { runStrategist } from "./strategist";
import { offeredToday, scanSuggestions } from "./suggestions";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

type Block = Anthropic.ContentBlock;
const toolUse = (id: string, name: string, input: unknown): Block =>
  ({ type: "tool_use", id, name, input }) as Block;
const reply = (content: Block[], stop: "tool_use" | "end_turn") =>
  ({ content, stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 200 } }) as never;

// A fake Claude, played from a script. Each step may look at what the app sent back.
function fake(steps: ((messages: Anthropic.MessageParam[]) => Block[] | null)[]) {
  const sent: Anthropic.MessageParam[][] = [];
  let at = 0;
  return {
    sent,
    claude: () =>
      ({
        messages: {
          create: async (params: { messages: Anthropic.MessageParam[] }) => {
            sent.push(structuredClone(params.messages));
            const content = steps[Math.min(at, steps.length - 1)](params.messages);
            at += 1;
            return content ? reply(content, "tool_use") : reply([], "end_turn");
          },
        },
      }) as never,
  };
}

// The suggestions_now result Claude was given, from the conversation so far.
function given(
  messages: Anthropic.MessageParam[],
): { key: string; worth: string; sureness: string }[] {
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (
        part.type === "tool_result" &&
        typeof part.content === "string" &&
        part.content.startsWith("[")
      ) {
        return JSON.parse(part.content);
      }
    }
  }
  return [];
}

describe.runIf(url)("Claude as strategist", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  const person = async (who: "debt" | "family" | "freelancer") => {
    const trial = await startTrial({ client, now: NOW, defer: true, person: who });
    await syncItem(trial.itemId, { client, now: NOW });
    made.push(trial.userId);
    return trial.userId;
  };

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("proposes nothing without a key", async () => {
    const userId = await person("debt");
    expect(await runStrategist(userId, { client, now: NOW })).toEqual({ status: "no_key" });
    expect(
      await client.suggestion.count({ where: { userId, capability: STRATEGIST_CAPABILITY } }),
    ).toBe(0);
  });

  it("keeps an idea resting on real suggestions, with the weakest part's confidence, and drops the rest", async () => {
    const userId = await person("debt");
    await scanSuggestions(userId, { client, now: NOW });
    const script = fake([
      () => [toolUse("a", "suggestions_now", {})],
      (messages) => {
        const keys = given(messages);
        const [one, two] = keys;
        return [
          // Good: two real keys and a figure from the tool.
          toolUse("b", "propose_idea", {
            title: "Stop the fees and the interest together",
            body: `Fees and interest are the same drain: the first is worth ${one.worth.split(" ")[0]}.`,
            based_on: [one.key, two.key],
          }),
          // A figure no tool gave.
          toolUse("c", "propose_idea", {
            title: "Win big",
            body: "This would save you $987,654.32 a year.",
            based_on: [one.key, two.key],
          }),
          // Only one suggestion behind it.
          toolUse("d", "propose_idea", {
            title: "Just one",
            body: "Nothing to combine here.",
            based_on: [one.key],
          }),
          // A key that is not there.
          toolUse("e", "propose_idea", {
            title: "Made up",
            body: "Based on something else.",
            based_on: [one.key, "cost:nonsense"],
          }),
          // A promise.
          toolUse("f", "propose_idea", {
            title: "Guaranteed",
            body: "This is guaranteed to fix everything.",
            based_on: [one.key, two.key],
          }),
        ];
      },
      () => null,
    ]);
    const out = await runStrategist(userId, { client, now: NOW, claude: script.claude });
    expect(out).toMatchObject({ status: "ran", kept: 1 });
    expect(out.status === "ran" && out.dropped).toHaveLength(4);
    const [row] = await client.suggestion.findMany({
      where: { userId, capability: STRATEGIST_CAPABILITY },
    });
    expect(row.key.startsWith("strategist:")).toBe(true);
    // Its confidence is the weakest of the two suggestions it rests on, not Claude's say-so.
    const parts = row.key.slice("strategist:".length).split("+");
    const partRows = await client.suggestion.findMany({ where: { userId, key: { in: parts } } });
    expect(row.confidencePercent).toBe(Math.min(...partRows.map((p) => p.confidencePercent)));
    expect(row.confidenceReason).toMatch(/^the weakest part of this idea: /);
    // Not asked again this week.
    expect(await runStrategist(userId, { client, now: NOW, claude: script.claude })).toEqual({
      status: "not_due",
    });
  });

  it("joins the ranking: offered with its parts' buttons, and its parts aren't offered beside it", async () => {
    const userId = await person("family");
    await scanSuggestions(userId, { client, now: NOW });
    // The two best-ranked suggestions tonight: an idea that combines them outranks each alone.
    const best = await client.suggestion.findMany({
      where: { userId, status: { in: ["waiting", "selected"] } },
      orderBy: { score: "desc" },
      take: 2,
      select: { key: true },
    });
    const script = fake([
      () => [toolUse("a", "suggestions_now", {})],
      (messages) => {
        const keys = given(messages).map((k) => k.key);
        return [
          toolUse("b", "propose_idea", {
            title: "Cover the family and trim the mortgage together",
            body: "Two things for the same household.",
            based_on: best.map((b) => b.key).filter((k) => keys.includes(k)),
          }),
        ];
      },
      () => null,
    ]);
    expect(
      await runStrategist(userId, { client, now: NOW, claude: script.claude, force: true }),
    ).toMatchObject({
      status: "ran",
      kept: 1,
    });
    // A new day, so the scan ranks again with the idea in.
    const next = new Date(NOW.getTime() + 86_400_000 * 3);
    await client.suggestion.updateMany({
      where: { userId },
      data: { selectedOn: null, status: "waiting" },
    });
    await scanSuggestions(userId, { client, now: next });
    const offered = await offeredToday(userId, { client, now: next });
    const idea = offered.find((o) => o.key.startsWith("strategist:"));
    expect(idea, offered.map((o) => o.key).join(",")).toBeDefined();
    expect(idea!.more.length).toBeGreaterThan(0);
    for (const part of idea!.key.slice("strategist:".length).split("+")) {
      expect(offered.some((o) => o.key === part)).toBe(false);
    }
    expect(typeof idea!.advice).toBe("boolean");
  });

  it("shows no advice topics to real accounts, and stops at the day's cost cap", async () => {
    const userId = await person("freelancer");
    await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "My real account",
        type: "depository",
        currentBalanceCents: 100,
      },
    });
    let seen: { key: string }[] = [];
    const script = fake([
      () => [toolUse("a", "suggestions_now", {})],
      (messages) => {
        seen = given(messages);
        return null;
      },
    ]);
    await runStrategist(userId, { client, now: NOW, claude: script.claude });
    expect(seen.length).toBeGreaterThan(0);
    for (const k of seen) {
      expect((ADVICE_TOPICS as readonly string[]).some((t) => k.key.endsWith(`:${t}`))).toBe(false);
    }
    await addSpend(
      userId,
      { model: "claude-sonnet-5-5", inputTokens: 5_000_000, outputTokens: 0 },
      { client, now: NOW },
    );
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    await addSpend(
      userId,
      { model: "claude-sonnet-5-5", inputTokens: 5_000_000, outputTokens: 0 },
      { client, now: later },
    );
    expect(await runStrategist(userId, { client, now: later, claude: script.claude })).toEqual({
      status: "capped",
    });
  });
});
