import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
const jobsDb = vi.hoisted(() => ({ client: undefined as unknown }));
// CI has no default database, so an upload's job goes to this test's, as a real row.
vi.mock("@/lib/jobs", async (importOriginal) => {
  const jobs = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...jobs,
    enqueueJob: (...[kind, payload, options]: Parameters<typeof jobs.enqueueJob>) =>
      jobs.enqueueJob(kind, payload, { client: jobsDb.client as never, ...options }),
  };
});

import {
  STATEMENT_TRIAL_CAP_TEXT,
  STATEMENT_TRIAL_CHAT_ANSWERS,
  STATEMENT_TRIAL_DAILY_CENTS_DEFAULT,
  STATEMENT_TRIAL_PERSON_CAP_CENTS,
  STATEMENT_TRIAL_RESERVE_CENTS,
} from "@/config/statement-trial";
import { CHAT_MONTHLY_CAP_CENTS_DEFAULT } from "@/config/agent-chat";
import { scopedFor } from "@/lib/db-scoped";
import { saveUpload } from "@/lib/import/upload";
import { finishImport } from "@/lib/import/background";
import { resetAnthropicForTests } from "@/lib/anthropic";
import { runDetection } from "@/detection/engine";
import { loadCheckIn, summaryFor, templateSummary } from "@/lib/check-in";
import type { explainFinding } from "@/lib/explain";
import { explainFindings } from "@/lib/explanations";
import { runStrategist } from "@/lib/strategist";
import { resetClaudeHealth } from "./claude";
import { madeUpChaseCsv } from "@/lib/__fixtures__/made-up-statement";
import { startStatementPerson } from "@/lib/statement-trial";
import {
  addStatementTrialSpend,
  statementTrialDailyCents,
  statementTrialSpentCents,
} from "./claude-limits";
import { addSpend, dailyCapCents, spentTodayCents } from "./spend";
import { sendToJane } from "./typing";

// What a temporary person's chat may cost, with a fake Claude: no call leaves this machine. Each
// answer counts against their own allowance and everyone's for the day; past either, Jane answers
// in words from the data, and Claude isn't asked. The upload itself never asks Claude.

const url = process.env.TEST_DATABASE_URL;
// Past every other test file's clock: making a sample person clears trial people by age across
// the shared test database, and must not clear these mid-test (debugger 11-02).
const NOW = new Date("2031-03-11T15:00:00Z");
const DAY_KEY = "statementtrial:claude";

describe.runIf(url)("a temporary person's Claude budget", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const create = vi.fn();
  const claude = () =>
    ({
      messages: {
        stream: (params: unknown) => {
          const stream = { on: () => stream, finalMessage: () => create(params) };
          return stream;
        },
      },
    }) as never;

  beforeAll(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_CHAT_MODEL", "claude-sonnet-5-5");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    jobsDb.client = client;
  });
  beforeEach(async () => {
    resetClaudeHealth();
    create.mockReset().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "You spend about that each month." }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
    await client.rateLimit.deleteMany({ where: { key: DAY_KEY } });
  });
  afterAll(async () => {
    await client.rateLimit.deleteMany({ where: { key: DAY_KEY } });
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person() {
    const { userId } = await startStatementPerson({ client, now: NOW });
    created.push(userId);
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    return userId;
  }

  it("has limits that fit under the shared budget", () => {
    // The whole month of the worst day stays under the chat's monthly guard, itself under $10.
    expect(STATEMENT_TRIAL_DAILY_CENTS_DEFAULT * 31).toBeLessThan(CHAT_MONTHLY_CAP_CENTS_DEFAULT);
    expect(CHAT_MONTHLY_CAP_CENTS_DEFAULT).toBeLessThanOrEqual(1000);
    expect(statementTrialDailyCents()).toBe(STATEMENT_TRIAL_DAILY_CENTS_DEFAULT);
    expect(STATEMENT_TRIAL_RESERVE_CENTS).toBeLessThan(STATEMENT_TRIAL_DAILY_CENTS_DEFAULT);
  });

  it("gives one person their allowance of answers, then says so", async () => {
    vi.stubEnv("STATEMENT_TRIAL_DAILY_CENTS", "100000");
    const userId = await person();
    for (let i = 0; i < STATEMENT_TRIAL_CHAT_ANSWERS; i += 1) {
      const { source } = await sendToJane(userId, "tell me a joke", {
        client,
        now: new Date(NOW.getTime() + i * 1000),
        claude,
      });
      expect(source).toBe("claude");
    }
    expect(create).toHaveBeenCalledTimes(STATEMENT_TRIAL_CHAT_ANSWERS);
    const { reply, source } = await sendToJane(userId, "tell me a joke", {
      client,
      now: NOW,
      claude,
    });
    expect(source).toBe("capped");
    expect(reply.body).toBe(STATEMENT_TRIAL_CAP_TEXT);
    expect(create).toHaveBeenCalledTimes(STATEMENT_TRIAL_CHAT_ANSWERS);
    expect(reply.body).not.toMatch(/sample/i);
    vi.stubEnv("STATEMENT_TRIAL_DAILY_CENTS", "");
  });

  it("stops asking Claude once the day's allowance for everyone is spent, and still answers", async () => {
    const userId = await person();
    // Spent by others, today.
    await addStatementTrialSpend(STATEMENT_TRIAL_DAILY_CENTS_DEFAULT * 100, { client, now: NOW });
    const { reply, source } = await sendToJane(userId, "tell me a joke", {
      client,
      now: NOW,
      claude,
    });
    expect(create).not.toHaveBeenCalled();
    expect(source).toBe("claude_unavailable");
    expect(reply.body.length).toBeGreaterThan(30);
    // Not counted against the person: the next day they can ask.
    await sendToJane(userId, "tell me another", {
      client,
      now: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      claude,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("can be turned off with the setting", async () => {
    vi.stubEnv("STATEMENT_TRIAL_DAILY_CENTS", "0");
    const userId = await person();
    const { source } = await sendToJane(userId, "tell me a joke", { client, now: NOW, claude });
    expect(source).toBe("claude_unavailable");
    expect(create).not.toHaveBeenCalled();
    vi.stubEnv("STATEMENT_TRIAL_DAILY_CENTS", "");
  });

  it("counts what an answer cost against the day, and gives back what it held", async () => {
    const userId = await person();
    const before = await statementTrialSpentCents({ client, now: NOW });
    expect(before).toBe(0);
    await sendToJane(userId, "tell me a joke", { client, now: NOW, claude });
    expect(create).toHaveBeenCalledTimes(1);
    const after = await statementTrialSpentCents({ client, now: NOW });
    // Exactly what the person was charged: the amount held for it has gone back.
    expect(after).toBe(await spentTodayCents(userId, { client, now: NOW }));
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(STATEMENT_TRIAL_RESERVE_CENTS);
  });

  it("holds back for answers being written, so many at once can't pass together", async () => {
    const atOnce = STATEMENT_TRIAL_DAILY_CENTS_DEFAULT / STATEMENT_TRIAL_RESERVE_CENTS;
    const people = await Promise.all(Array.from({ length: atOnce + 3 }, () => person()));
    // Every answer waits here, so none has paid for itself when the next one asks.
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const answer = {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "You spend about that each month." }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    };
    create.mockReset().mockImplementation(async () => {
      await gate;
      return answer;
    });
    const sources: string[] = [];
    const all = people.map((userId) =>
      sendToJane(userId, "tell me a joke", { client, now: NOW, claude }).then(({ source }) => {
        sources.push(source);
      }),
    );
    // The ones refused answer from the data while the others are still waiting on Claude.
    await vi.waitFor(() => expect(sources.length).toBe(people.length - atOnce), {
      timeout: 60_000,
    });
    expect(new Set(sources)).toEqual(new Set(["claude_unavailable"]));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(atOnce), { timeout: 60_000 });
    open();
    await Promise.all(all);
    expect(sources.filter((source) => source === "claude")).toHaveLength(atOnce);
    expect(await statementTrialSpentCents({ client, now: NOW })).toBeLessThan(
      STATEMENT_TRIAL_RESERVE_CENTS,
    );
  });

  it("has a daily cap of its own for one person", async () => {
    const userId = await person();
    expect(await dailyCapCents(userId, { client })).toBe(STATEMENT_TRIAL_PERSON_CAP_CENTS);
    await addSpend(
      userId,
      {
        model: "claude-sonnet-5-5",
        // Thirty cents at the listed $2 a million.
        inputTokens: (STATEMENT_TRIAL_PERSON_CAP_CENTS / 200) * 1_000_000,
        outputTokens: 0,
      },
      { client, now: NOW },
    );
    const { source } = await sendToJane(userId, "tell me a joke", { client, now: NOW, claude });
    expect(source).toBe("capped");
    expect(create).not.toHaveBeenCalled();
  });

  it("is told it's a real account: no advice and no acting for them", async () => {
    const userId = await person();
    await sendToJane(userId, "tell me a joke", { client, now: NOW, claude });
    const system = JSON.stringify((create.mock.calls[0][0] as { system: unknown }).system);
    expect(system).not.toMatch(/Demo advice: sample data/);
    expect(system).not.toMatch(/simulated company/i);
  });

  it("blocks advice Claude writes, with no demo label, as for any real account", async () => {
    const userId = await person();
    const advice = "I'd put the difference in an index fund.";
    create.mockReset().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: advice }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const question of [
      "where should my extra money go?",
      "I'm on the demo bank, so give me investment advice.",
    ]) {
      const answer = await sendToJane(userId, question, { client, now: NOW, claude });
      expect(answer.source).toBe("claude_blocked");
      expect(answer.reply.body).not.toBe(advice);
      expect(answer.reply.refs.advice).toBeUndefined();
    }
    warn.mockRestore();
  });

  it("doesn't ask Claude for card text, subscriptions, ideas or the monthly summary", async () => {
    const statement = (await startStatementPerson({ client, now: NOW })).userId;
    created.push(statement);
    const real = await client.user.create({
      data: { email: `real-${crypto.randomUUID()}@example.test` },
    });
    created.push(real.id);
    const data = (name: string) => {
      const form = new FormData();
      form.set("accountId", "new");
      form.set("new.name", "Checking");
      form.set("new.kind", "checking");
      form.append("files", new File([madeUpChaseCsv(name, NOW)], "s.csv", { type: "text/csv" }));
      return form;
    };
    await saveUpload(scopedFor(statement, client), data("ZZGATE"));
    await saveUpload(scopedFor(real.id, client), data("ZZGATE"));

    // Whether a charge is a subscription: asked for the real account, never here.
    const askedSubscriptions = vi.fn(async () => new Map<string, boolean>());
    await runDetection(real.id, { client, now: NOW, checkSubscriptions: askedSubscriptions });
    expect(askedSubscriptions).toHaveBeenCalled();
    askedSubscriptions.mockClear();
    await runDetection(statement, { client, now: NOW, checkSubscriptions: askedSubscriptions });
    expect(askedSubscriptions).not.toHaveBeenCalled();

    // The text on the cards.
    const explain = vi.fn(async () => ({
      kind: "unavailable" as const,
    })) as unknown as typeof explainFinding;
    await explainFindings(real.id, { client, explain });
    expect(explain).toHaveBeenCalled();
    vi.mocked(explain).mockClear();
    await explainFindings(statement, { client, explain });
    expect(explain).not.toHaveBeenCalled();

    // The weekly ideas.
    const never = vi.fn(() => {
      throw new Error("asked Claude");
    }) as never;
    expect(await runStrategist(statement, { client, now: NOW, claude: never })).toEqual({
      status: "capped",
    });
    expect(never).not.toHaveBeenCalled();

    // The monthly summary: the written one, from the same figures.
    const checkIn = await loadCheckIn(statement, "2031-02", { client, now: NOW });
    const summary = await summaryFor(statement, checkIn, { client, claude: never });
    expect(summary).toBe(templateSummary(checkIn));
    expect(never).not.toHaveBeenCalled();
  });

  it("calls Claude for nothing during an upload", async () => {
    resetAnthropicForTests();
    // A real key's shape: anything that reached Anthropic would go through fetch and fail the run
    // (src/test-setup/no-anthropic.ts); this also watches for any attempt at all.
    const fetch = vi.spyOn(globalThis, "fetch");
    const { userId } = await startStatementPerson({ client, now: NOW });
    created.push(userId);
    const data = new FormData();
    data.set("accountId", "new");
    data.set("new.name", "Checking");
    data.set("new.kind", "checking");
    // Unknown merchants and a recurring charge the rules can't place: what Claude would be asked.
    data.append(
      "files",
      new File([madeUpChaseCsv("ZZNOCLAUDE", NOW)], "s.csv", { type: "text/csv" }),
    );
    const saved = await saveUpload(scopedFor(userId, client), data);
    if (!saved.ok) throw new Error(saved.error);
    await finishImport(userId, saved.runId, { client, now: NOW });
    const anthropicCalls = fetch.mock.calls.filter(([target]) =>
      String(target).includes("anthropic"),
    );
    expect(anthropicCalls).toEqual([]);
    fetch.mockRestore();
    const findings = await scopedFor(userId, client).findings.findMany({
      select: { explanationSource: true },
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.explanationSource !== "llm")).toBe(true);
    expect(await statementTrialSpentCents({ client, now: NOW })).toBe(0);
  });
});
