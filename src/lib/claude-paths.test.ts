import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { classifyMerchants } from "@/categorize/llm";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  CLAUDE_BACKGROUND_DAILY_CAP_CENTS,
  CLAUDE_BACKGROUND_MONTHLY_CAP_CENTS,
  CHAT_MONTHLY_CAP_CENTS_DEFAULT,
} from "@/config/agent-chat";
import { readReply } from "./agent/read-reply";
import { findSupportContact } from "./agent/find-contact";
import { backgroundCapHit, chargeBackground, meteredClaude } from "./claude-budget";
import { writeSummary } from "./check-in";
import { readDocumentFacts } from "./documents/extract";
import { draftMessage } from "./drafts";
import { explainFinding } from "./explain";
import { readFields } from "./read-fields";
import { checkSubscriptions } from "./subscription-check";

// Plan item 13: every path that calls Claude has a limit, and past it Claude isn't called. A new
// path fails the first test until it is listed here with what limits it.

const LIMITED_BY: Record<string, string> = {
  // The person's chat allowance: daily and the month's total.
  "src/lib/jane-agent/claude.ts": "overDailyCap",
  "src/lib/strategist.ts": "overDailyCap",
  // What the caller hands in is meteredClaude(userId): see CALLERS below.
  "src/categorize/llm.ts": "metered by its callers",
  "src/lib/agent/find-contact.ts": "metered by its callers",
  "src/lib/agent/read-reply.ts": "metered by its callers",
  "src/lib/check-in.ts": "metered by its callers",
  "src/lib/documents/extract.ts": "metered by its callers",
  "src/lib/drafts.ts": "metered by its callers",
  "src/lib/explain.ts": "metered by its callers",
  "src/lib/read-fields.ts": "metered by its callers",
  "src/lib/subscription-check.ts": "metered by its callers",
  // The limit itself: every metered call goes through it.
  "src/lib/claude-budget.ts": "backgroundCapHit",
  // No person: its own monthly cap (NEWS_MONTHLY_CAP_CENTS) and calls a day.
  "src/lib/news/summarize.ts": "NEWS_MONTHLY_CAP",
  // The eval CLI, never the app: ANSWER_CHECK_CAP_CENTS.
  "src/lib/jane-agent/checks/grader.ts": "eval only",
  "src/lib/jane-agent/checks/run.ts": "eval only",
};

// Each app caller of a path above, and the text that shows it hands Claude in metered.
const CALLERS: [file: string, shows: RegExp][] = [
  ["src/lib/explanations.ts", /meteredClaude\(userId\)[\s\S]*explain\(f, \{ claude \}\)/],
  ["src/lib/agent/run.ts", /draftMessage\(action\.type, finding, \{[^}]*client: meteredClaude/],
  ["src/lib/agent/run.ts", /await read\([\s\S]{0,120}client: meteredClaude/],
  ["src/lib/agent/run.ts", /findSupportContact\(row\.id, \{ client, claude: meteredClaude/],
  ["src/lib/voice/calls.ts", /draftMessage\(action\.type, finding, \{[^}]*client: meteredClaude/],
  ["src/app/admin/actions/[actionId]/actions.ts", /draftMessage\([^;]*client: meteredClaude/],
  ["src/lib/check-in.ts", /claude = meteredClaude\(userId\)/],
  ["src/lib/documents/store.ts", /claude = meteredClaude\(userId\)/],
  ["src/lib/tax-notices/index.ts", /claude = meteredClaude\(userId\)/],
  ["src/lib/draft-return/index.ts", /claude = meteredClaude\(userId\)/],
  ["src/lib/prior-return/index.ts", /claude = meteredClaude\(userId\)/],
  ["src/lib/insurance/readings.ts", /meteredClaude\(userId\)/],
  ["src/detection/engine.ts", /subscriptionMerchantKeys\([\s\S]{0,80}meteredClaude\(db\.userId/],
  [
    "src/lib/plaid/sync.ts",
    /categorizeTransactions\(sync\.transactions, db, \{\s*claude: meteredClaude/,
  ],
  ["src/lib/import/background.ts", /categorizeLeftovers\(db, \{\s*claude: meteredClaude/],
];

const CALLS_CLAUDE = /\.messages\s*\.\s*(?:create|stream)\s*\(/;
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("every path that calls Claude has a limit", () => {
  const paths = sourceFiles("src").filter((f) => CALLS_CLAUDE.test(readFileSync(f, "utf8")));

  it("is listed here", () => {
    expect(paths.sort()).toEqual(Object.keys(LIMITED_BY).sort());
  });

  it.each(CALLERS)("%s hands Claude in metered", (file, shows) => {
    expect(readFileSync(file, "utf8")).toMatch(shows);
  });

  it("a whole month of one person can't use up the month", () => {
    expect(CLAUDE_BACKGROUND_MONTHLY_CAP_CENTS).toBeLessThan(CHAT_MONTHLY_CAP_CENTS_DEFAULT / 2);
  });
});

// The limit itself: counters kept in memory the way rate_limits keeps them.
const NOW = new Date("2026-11-03T12:00:00Z");
function fakeDb({ role = "user", email = "person@example.com" } = {}) {
  const rows = new Map<string, number>();
  const client = {
    rateLimit: {
      findUnique: async ({
        where,
      }: {
        where: { key_windowStart: { key: string; windowStart: Date } };
      }) => {
        const { key, windowStart } = where.key_windowStart;
        const count = rows.get(`${key}@${windowStart.toISOString()}`);
        return count === undefined ? null : { count };
      },
    },
    user: { findUnique: async () => ({ role, email }) },
    $executeRaw: async (_strings: TemplateStringsArray, key: string, at: Date, amount: number) => {
      const id = `${key}@${at.toISOString()}`;
      rows.set(id, (rows.get(id) ?? 0) + amount);
      return 1;
    },
  };
  return { client: client as unknown as PrismaClient, rows };
}

const answer = (text: string, usage: object = { input_tokens: 1_000, output_tokens: 100 }) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage,
});

// 50 cents of Claude at Opus: 100,000 input tokens is 40, 5,000 output is 10.
const FIFTY_CENTS = { input_tokens: 100_000, output_tokens: 5_000 };

describe("meteredClaude", () => {
  const create = vi.fn();
  const real = (() => ({ messages: { create } })) as never;

  beforeEach(() => {
    create.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "");
    vi.stubEnv("ADMIN_EMAILS", "founder@example.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const params = { model: "claude-opus-5-5", max_tokens: 10, messages: [] };
  const call = (claude: ReturnType<typeof meteredClaude>) => claude().messages.create(params);

  it("passes a call through and charges the person for it", async () => {
    const { client } = fakeDb();
    create.mockResolvedValueOnce(answer("ok", FIFTY_CENTS));
    const metered = meteredClaude("u1", { client, now: NOW, claude: real });
    await call(metered);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await backgroundCapHit("u1", { client, now: NOW })).toBe(true);
  });

  it("past the day's limit it answers like a busy API, and Claude isn't called", async () => {
    const { client } = fakeDb();
    await chargeBackground("u1", "claude-opus-5-5", FIFTY_CENTS as never, { client, now: NOW });
    const metered = meteredClaude("u1", { client, now: NOW, claude: real });
    await expect(call(metered)).rejects.toBeInstanceOf(Anthropic.APIError);
    await expect(call(metered)).rejects.toMatchObject({ status: 429 });
    expect(create).not.toHaveBeenCalled();
  });

  it("the next day is a new day, until the month's limit", async () => {
    const { client } = fakeDb();
    for (let day = 3; day <= 5; day += 1) {
      const at = new Date(`2026-11-0${day}T12:00:00Z`);
      expect(await backgroundCapHit("u1", { client, now: at })).toBe(false);
      await chargeBackground("u1", "claude-opus-5-5", FIFTY_CENTS as never, { client, now: at });
    }
    expect(await backgroundCapHit("u1", { client, now: new Date("2026-11-06T12:00:00Z") })).toBe(
      true,
    );
    expect(await backgroundCapHit("u1", { client, now: new Date("2026-12-01T12:00:00Z") })).toBe(
      false,
    );
    expect(CLAUDE_BACKGROUND_DAILY_CAP_CENTS * 3).toBe(CLAUDE_BACKGROUND_MONTHLY_CAP_CENTS);
  });

  it("one person's limit is theirs alone", async () => {
    const { client } = fakeDb();
    await chargeBackground("u1", "claude-opus-5-5", FIFTY_CENTS as never, { client, now: NOW });
    expect(await backgroundCapHit("u2", { client, now: NOW })).toBe(false);
  });

  it("a sample person has no background Claude at all", async () => {
    const { client } = fakeDb();
    expect(await backgroundCapHit("trial_a", { client, now: NOW })).toBe(true);
  });

  it("an admin has no limit of their own, but the month's total stops everyone", async () => {
    const { client } = fakeDb({ role: "admin" });
    await chargeBackground("u1", "claude-opus-5-5", FIFTY_CENTS as never, { client, now: NOW });
    expect(await backgroundCapHit("u1", { client, now: NOW })).toBe(false);
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "40");
    expect(await backgroundCapHit("u1", { client, now: NOW })).toBe(true);
  });

  it("what it charges counts toward the month's total for all of Claude", async () => {
    const { client, rows } = fakeDb();
    await chargeBackground("u1", "claude-opus-5-5", FIFTY_CENTS as never, { client, now: NOW });
    expect([...rows.keys()].some((k) => k.startsWith("chatmonth:total@"))).toBe(true);
    expect(rows.get("chatmonth:total@2026-11-01T00:00:00.000Z")).toBe(5_000);
  });

  it("a web search costs a cent on top of its tokens", async () => {
    const { client, rows } = fakeDb();
    await chargeBackground(
      "u1",
      "claude-opus-5-5",
      { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } } as never,
      { client, now: NOW },
    );
    expect(rows.get("chatmonth:total@2026-11-01T00:00:00.000Z")).toBe(300);
  });

  it("a count it can't read means Claude isn't asked", async () => {
    const client = {
      rateLimit: {
        findUnique: async () => {
          throw new Error("database down");
        },
      },
    } as unknown as PrismaClient;
    const metered = meteredClaude("u1", { client, now: NOW, claude: real });
    await expect(call(metered)).rejects.toMatchObject({ status: 429 });
    expect(create).not.toHaveBeenCalled();
  });

  it("a charge it can't save keeps the answer", async () => {
    const { client } = fakeDb();
    (client as unknown as { $executeRaw: () => Promise<never> }).$executeRaw = async () => {
      throw new Error("database down");
    };
    create.mockResolvedValueOnce(answer("ok"));
    const metered = meteredClaude("u1", { client, now: NOW, claude: real });
    await expect(call(metered)).resolves.toMatchObject({ stop_reason: "end_turn" });
  });

  describe("past the limit, each path falls back and never calls Claude", () => {
    const spent = () => {
      const { client } = fakeDb();
      return chargeBackground("u1", "claude-opus-5-5", FIFTY_CENTS as never, {
        client,
        now: NOW,
      }).then(() => meteredClaude("u1", { client, now: NOW, claude: real }));
    };
    const file = { bytes: new Uint8Array([1]), contentType: "application/pdf" } as never;

    it("a card's words: left for later", async () => {
      const claude = await spent();
      const result = await explainFinding(
        {
          type: "duplicate_charge",
          title: "Charged twice",
          annualSavingsCents: 100,
          evidence: {},
        } as never,
        { claude },
      );
      expect(result.kind).toBe("unavailable");
    });

    it("a draft: the template", async () => {
      const claude = await spent();
      const result = await draftMessage(
        "dispute_charge" as never,
        { type: "duplicate_charge", evidence: { merchant: "Target", charges: [] } } as never,
        { client: claude },
      );
      if (result) expect(result.kind).toBe("template");
    });

    it("a company's reply: the rules", async () => {
      const claude = await spent();
      const reading = await readReply(
        { subject: "Re", body: "We issued the refund today." },
        { client: claude },
      );
      expect(reading.source).toBe("rules");
    });

    it("a month's summary: the template", async () => {
      const claude = await spent();
      const result = await writeSummary(
        { month: "2026-10", spentCents: 0, incomeCents: 0, savedCents: 0 } as never,
        { claude },
      ).catch(() => ({ source: "template" }));
      expect(result.source).toBe("template");
    });

    it("an upload: you fill it in", async () => {
      const claude = await spent();
      const result = await readDocumentFacts(
        { ...(file as object), kind: "insurance_policy" } as never,
        { claude },
      );
      expect(result).toEqual({ kind: "failed", reason: "api_429" });
    });

    it("a form: you fill it in", async () => {
      const claude = await spent();
      const result = await readFields(file, { keys: ["a"], prompt: "p", maxTokens: 10, claude });
      expect(result).toEqual({ kind: "failed", reason: "api_429" });
    });

    it("subscription checks: asked again next scan", async () => {
      const claude = await spent();
      expect((await checkSubscriptions(["NETFLIX"], { claude })).size).toBe(0);
    });

    it("merchant sorting: asked again next import", async () => {
      const claude = await spent();
      expect((await classifyMerchants(["NETFLIX"], { claude })).size).toBe(0);
    });

    it("a support address: not looked up", async () => {
      const claude = await spent();
      const client = {
        merchant: {
          findUnique: async () => ({
            id: "m1",
            name: "Netflix",
            supportUrl: "https://netflix.com/help",
            cancelUrl: null,
            supportEmail: null,
            suggestedSupportEmail: null,
          }),
        },
      } as unknown as PrismaClient;
      expect(await findSupportContact("m1", { client, claude })).toBeNull();
    });

    afterEach(() => {
      expect(create).not.toHaveBeenCalled();
    });
  });
});
