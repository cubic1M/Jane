import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_ALL_TRIALS_DAILY_CAP_CENTS } from "@/config/agent-chat";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { resetLlmClientForTests } from "@/categorize/llm";
import { categorizeTransactions } from "@/categorize/categorize";
import { resetAnthropicForTests } from "@/lib/anthropic";
import { loadCheckIn, summaryFor } from "@/lib/check-in";
import { scopedFor } from "@/lib/db-scoped";
import { syncItem } from "@/lib/plaid/sync";
import { addDocument } from "@/lib/documents/store";
import { draftMessage } from "@/lib/drafts";
import { explainFindings } from "@/lib/explanations";
import { addMonthlySpend, claudeLimit, monthlyCapCents } from "@/lib/jane-agent/claude-limits";
import { addSpend, overDailyCap } from "@/lib/jane-agent/spend";
import { runStrategist } from "@/lib/strategist";
import { startTrial } from "@/lib/trial";

// Anyone can make a sample person without an account, so nothing about one may spend money on
// Claude except the answers they type, and those have a ceiling across all of them. Measured on a
// production build before this: one click on "Try it with sample data" made 11 Opus calls, and
// each upload sent the whole file to Opus twice, about 1,000 calls an hour from one IP, outside
// every spend cap. These run the same steps with a counting stand-in for Anthropic's API.

const url = process.env.TEST_DATABASE_URL;

const PDF = new TextEncoder().encode(`%PDF-1.4\n% made up for a test\n${"x".repeat(200)}`);
const answer = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "test",
  content: [{ type: "text", text: "{}" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 1 },
};

describe.runIf(url)("what a sample person can spend on Claude", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let claudeCalls: number;
  const created: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "not-a-real-key");
    resetAnthropicForTests();
    resetLlmClientForTests();
    claudeCalls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const target =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!target.includes("anthropic.com")) throw new Error(`Unexpected request to ${target}`);
      claudeCalls += 1;
      return Response.json(answer);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    resetAnthropicForTests();
    resetLlmClientForTests();
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.rateLimit.deleteMany({ where: { key: "trialspend:all" } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("makes no call for a sample person's first scan, explanations, summary or strategist", async () => {
    // defer, then the sync: without it startTrial clears finished trials for everyone, and at this
    // date that's the trials other test files are using in the shared database.
    const started = new Date("2031-05-01T12:00:00Z");
    const trial = await startTrial({ client, now: started, defer: true });
    created.push(trial.userId);
    await syncItem(trial.itemId, { client, now: started });
    await explainFindings(trial.userId, { client });
    const now = new Date("2031-05-02T12:00:00Z");
    await summaryFor(trial.userId, await loadCheckIn(trial.userId, "2031-04", { client, now }), {
      client,
    });
    expect((await runStrategist(trial.userId, { client, now, force: true })).status).toBe("no_key");
    expect(claudeCalls).toBe(0);
  });

  it("keeps a sample person's upload without sending it to Claude", async () => {
    const id = `${TRIAL_ID_PREFIX}${randomBytes(8).toString("hex")}`;
    await client.user.create({ data: { id, email: `${id}@example.test` } });
    created.push(id);
    const result = await addDocument(
      id,
      {
        file: { name: "notice.pdf", type: "application/pdf", size: PDF.length },
        bytes: PDF,
        kind: "other",
      },
      { client },
    );
    expect(result).toMatchObject({ ok: true, read: "you" });
    expect(claudeCalls).toBe(0);
  });

  it("still sends a real person's upload and merchants to Claude", async () => {
    const user = await client.user.create({
      data: { email: `trial-claude-${randomBytes(6).toString("hex")}@example.test` },
    });
    created.push(user.id);
    await addDocument(
      user.id,
      {
        file: { name: "notice.pdf", type: "application/pdf", size: PDF.length },
        bytes: PDF,
        kind: "other",
      },
      { client },
    );
    expect(claudeCalls).toBe(1);
    await categorizeTransactions(
      [
        {
          accountRef: "a",
          date: "2031-05-01",
          amountCents: 1000,
          description: "ZZQX UNPLACED SHOP",
          merchantName: null,
          categoryPrimary: null,
          categoryDetailed: null,
          pending: false,
          externalId: "t1",
          hints: {},
        },
      ],
      scopedFor(user.id, client),
    );
    expect(claudeCalls).toBe(2);
  });

  it("asks nothing about a sample person's merchants", async () => {
    const id = `${TRIAL_ID_PREFIX}${randomBytes(8).toString("hex")}`;
    await client.user.create({ data: { id, email: `${id}@example.test` } });
    created.push(id);
    await categorizeTransactions(
      [
        {
          accountRef: "a",
          date: "2031-05-01",
          amountCents: 1000,
          description: "ZZQX UNPLACED SHOP",
          merchantName: null,
          categoryPrimary: null,
          categoryDetailed: null,
          pending: false,
          externalId: "t1",
          hints: {},
        },
      ],
      scopedFor(id, client),
    );
    expect(claudeCalls).toBe(0);
  });

  it("writes a sample person's letter from the template", async () => {
    const draft = await draftMessage(
      "cancel_subscription",
      { id: "f1", type: "forgotten_subscription", annualSavingsCents: 1200, evidence: {} } as never,
      { useClaude: false },
    );
    expect(draft?.kind ?? "template").toBe("template");
    expect(claudeCalls).toBe(0);
  });

  it("stops all sample people at the day's shared ceiling, and only them", async () => {
    const now = new Date("2031-06-10T12:00:00Z");
    await client.rateLimit.deleteMany({ where: { key: "trialspend:all" } });
    const fresh = `${TRIAL_ID_PREFIX}${randomBytes(8).toString("hex")}`;
    const real = await client.user.create({
      data: { email: `trial-claude-${randomBytes(6).toString("hex")}@example.test` },
    });
    created.push(real.id);
    expect(await overDailyCap(fresh, { client, now })).toBe(false);
    // Spent by many other sample people, none of them near their own limit.
    const dollarOfOpus = Math.ceil((CHAT_ALL_TRIALS_DAILY_CAP_CENTS / 400) * 1_000_000);
    await addSpend(
      `${TRIAL_ID_PREFIX}${randomBytes(8).toString("hex")}`,
      { model: "claude-opus-5-5", inputTokens: dollarOfOpus, outputTokens: 0 },
      { client, now },
    );
    expect(await overDailyCap(fresh, { client, now })).toBe(true);
    expect(await overDailyCap(real.id, { client, now })).toBe(false);
  });

  it("keeps part of the month's budget out of sample people's reach", async () => {
    const now = new Date("2031-07-10T12:00:00Z");
    const trial = `${TRIAL_ID_PREFIX}${randomBytes(8).toString("hex")}`;
    const real = await client.user.create({
      data: { email: `trial-claude-${randomBytes(6).toString("hex")}@example.test` },
    });
    created.push(real.id);
    await addMonthlySpend(Math.ceil(monthlyCapCents() * 100 * 0.6), { client, now });
    expect(await claudeLimit(trial, { client, now })).toBe("budget");
    expect(await claudeLimit(real.id, { client, now })).toBeNull();
    await client.rateLimit.deleteMany({
      where: { key: "chatmonth:total", windowStart: new Date("2031-07-01T00:00:00Z") },
    });
  });
});
