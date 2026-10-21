import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { createCheckPerson, deleteCheckPerson } from "../checks/person";
import { sendToJane } from "../typing";

// A follow-up right after a card must work: "can you change my car insurance" gets the switch
// card (the real quote lookup), then "what are some other options from geico" is answered in
// words, with the real primer and snapshot, no card, and nothing about a button.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

type Block = Record<string, unknown>;
const fake = (steps: { stop: "tool_use" | "end_turn"; content: Block[] }[]) => {
  let call = 0;
  return () =>
    ({
      messages: {
        stream: () => {
          const step = steps[Math.min(call++, steps.length - 1)];
          const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
          const stream = {
            on(name: string, fn: (...a: unknown[]) => void) {
              (listeners[name] ??= []).push(fn);
              return stream;
            },
            async finalMessage() {
              for (const block of step.content) {
                (listeners.streamEvent ?? []).forEach((fn) =>
                  fn({ type: "content_block_start", content_block: block }),
                );
                if (block.type === "text") {
                  (listeners.text ?? []).forEach((fn) => fn(String(block.text)));
                }
              }
              return {
                stop_reason: step.stop,
                content: step.content,
                usage: { input_tokens: 100, output_tokens: 50 },
              };
            },
            abort() {},
          };
          return stream;
        },
      },
    }) as never;
};

describe.runIf(url)("a follow-up right after a card", () => {
  let client: PrismaClient;
  let userId = "";

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: NOW });
    await client.rateLimit.deleteMany({ where: { key: { startsWith: "chatmonth:" } } });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await client.$disconnect();
  });

  it("answers the follow-up from Claude, in words, with no card", async () => {
    const card = await sendToJane(userId, "can you change my car insurance", {
      client,
      now: NOW,
      primerMs: 60_000,
      claude: fake([
        {
          stop: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "propose_action",
              input: { action: "insurance.reshop", policy_kind: "car" },
            },
          ],
        },
        { stop: "end_turn", content: [{ type: "text", text: "Yes, I can switch it for you." }] },
      ]),
    });
    expect(card.source).toBe("claude");
    expect(card.reply.actions.some((a) => a.id === "insurance.shop_yes")).toBe(true);
    // The card is short: the pick, the saving, one line of why and what Yes does.
    expect(card.reply.body.length).toBeLessThan(700);

    const later = new Date(NOW.getTime() + 60_000);
    const follow = await sendToJane(userId, "what are some other options from geico", {
      client,
      now: later,
      primerMs: 60_000,
      claude: fake([
        {
          stop: "end_turn",
          content: [{ type: "text", text: "GEICO also has a plan with a higher deductible." }],
        },
      ]),
    });
    expect(follow.source).toBe("claude");
    expect(follow.reply.body).toMatch(/higher deductible/);
    expect(follow.reply.actions.filter((a) => a.kind !== "link")).toEqual([]);
    expect(follow.reply.body).not.toMatch(/button|couldn't/i);
  });
});
