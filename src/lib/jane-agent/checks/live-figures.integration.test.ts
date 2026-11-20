import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { resetClaudeHealth } from "../claude";
import { sendToJane } from "../typing";
import { loadFacts } from "./facts";
import { fixedChecks } from "./grade";
import { createCheckPerson, deleteCheckPerson } from "./person";

// The answer checks grade a Claude answer by the figures Jane's own check held it to on that turn
// (walk batch 3, 11-20). On the chat's own path: a figure calculate worked out is in the list the
// run is handed, so the grader passes the answer Jane sent; with the grader's own lookups alone it
// read as made up.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T19:00:00Z");
const usage = { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage;
// Their own words carry the amount, so calculate may use it (claude.ts: calculatorInputsNotOnFile).
const ASKED = "I take home $1,343.33 a month. How much is that a year?";
const ANSWER = "That's about $16,119.96 a year.";

// Claude, played back: calculate first, then the answer with its result.
const scripted = () => {
  let round = 0;
  return () =>
    ({
      messages: {
        stream: () => {
          round += 1;
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          const content: Anthropic.ContentBlock[] =
            round === 1
              ? [
                  {
                    type: "tool_use",
                    id: "calc1",
                    name: "calculate",
                    input: { operation: "per_year", basis: "monthly pay", amount: 1343.33 },
                  } as Anthropic.ToolUseBlock,
                ]
              : [{ type: "text", text: ANSWER, citations: null } as Anthropic.TextBlock];
          const stream = {
            on(name: string, fn: (...args: unknown[]) => void) {
              (listeners[name] ??= []).push(fn);
              return stream;
            },
            async finalMessage() {
              for (const block of content) {
                for (const fn of listeners.streamEvent ?? []) {
                  fn({ type: "content_block_start", content_block: block });
                }
                if (block.type === "text") for (const fn of listeners.text ?? []) fn(block.text);
              }
              return {
                stop_reason: round === 1 ? "tool_use" : "end_turn",
                usage,
                content,
              };
            },
          };
          return stream;
        },
      },
    }) as unknown as Anthropic;
};

describe.runIf(url)("the figures a Claude answer was held to", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let id = "";

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: NOW, person: "renter", ownAccount: true });
  });

  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("hands the run calculate's result, and the grader passes the answer Jane sent", async () => {
    resetClaudeHealth();
    let live: readonly number[] = [];
    const { reply, source, issues } = await sendToJane(id, ASKED, {
      client,
      now: NOW,
      claude: scripted(),
      primerMs: 60_000,
      onFigures: (allowed) => (live = allowed),
    });
    expect(issues ?? []).toEqual([]);
    expect(source).toBe("claude");
    expect(reply.body).toContain("$16,119.96");
    expect(live).toContain(1_611_996);

    const facts = await loadFacts(id, { client, now: NOW });
    const question = { id: "q", text: ASKED, needs: "claude" as const, expect: {} };
    const graded = (allowedCents?: readonly number[]) =>
      fixedChecks(
        question,
        {
          body: reply.body,
          actions: reply.actions,
          source,
          ...(allowedCents ? { allowedCents } : {}),
        },
        facts,
      ).find((c) => c.name === "guardrails")?.ok;
    expect(graded(live)).toBe(true);
    expect(graded()).toBe(false);
  });
});
