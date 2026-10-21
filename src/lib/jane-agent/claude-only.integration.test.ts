import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// A typed message must never be answered by the rules while Claude works.
const { rules } = vi.hoisted(() => ({
  rules: vi.fn(async () => {
    throw new Error("A typed message reached a rules answer");
  }),
}));
vi.mock("./answer", () => ({ answerByRules: rules }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { QUESTIONS } from "./checks/bank";
import { sendToJane } from "./typing";

// Chat architecture (docs/spec.md): every typed message is answered by Claude, writing from
// Jane's tools. No typed text reaches a rules answer (greetings, commands, decisions, QA's
// casual phrasings, the founder's transcript), and every reply is written words: a button or a
// card is never the whole reply.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const ANSWER =
  "Your cards cost you interest every month, so paying them first comes before the rest.";

const typed = QUESTIONS.filter(
  (q) =>
    ["casual", "decision", "chat"].includes(q.sector ?? "") ||
    /^(?:decf|decp|dec|qa|dbar|unrelated|voice|debt-moves|casual)-/.test(q.id),
).map((q) => q.text);
const FOUNDER = ["yea so should i be buying bitcoin", "why", "yea so should i buy bitcoin"];
const COMMANDS = [
  "hi",
  "thanks!",
  "help",
  "yes to all",
  "cancel hulu",
  "undo",
  "approve all",
  "pause autopilot",
];

describe.runIf(url)("every typed message is Claude's to answer", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const asked: string[] = [];
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `co-${crypto.randomUUID()}@example.com` } })
    ).id;
    const plaid = new Proxy({}, { get: () => () => {} }) as never;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  // Claude, played back: writes the answer first, then asks for a button, as instructed.
  const claude = () =>
    ({
      messages: {
        stream: (params: { messages: { content: unknown }[] }) => {
          const last = params.messages.at(-1)?.content;
          asked.push(typeof last === "string" ? last : "");
          const stream = {
            on: () => stream,
            finalMessage: async () => ({
              stop_reason: "end_turn",
              content: [{ type: "text", text: ANSWER }],
              usage: { input_tokens: 10, output_tokens: 10 },
            }),
          };
          return stream;
        },
      },
    }) as never;

  it("sends each one to Claude and returns Claude's written words, never a rules answer", async () => {
    const messages = [...new Set([...FOUNDER, ...COMMANDS, ...typed])];
    expect(messages.length).toBeGreaterThan(40);
    let tick = 0;
    for (const text of messages) {
      const { reply, source } = await sendToJane(userId, text, {
        client,
        now: new Date(LINKED.getTime() + ++tick * 60_000),
        claude,
        primerMs: 60_000,
      });
      expect(source, text).toBe("claude");
      expect(reply.body, text).toBe(ANSWER);
      // A real sentence, whatever buttons come with it.
      expect(reply.body.split(/\s+/).length, text).toBeGreaterThanOrEqual(5);
    }
    expect(rules).not.toHaveBeenCalled();
    expect(asked.length).toBe(messages.length);
  });

  it("answers in words from the data when Claude only talks about a button", async () => {
    rules.mockImplementationOnce(async () => null as never);
    const buttonOnly = () =>
      ({
        messages: {
          stream: () => {
            const stream = {
              on: () => stream,
              finalMessage: async () => ({
                stop_reason: "end_turn",
                content: [
                  { type: "text", text: "I've put a link to your debt plan under this answer." },
                ],
                usage: { input_tokens: 10, output_tokens: 10 },
              }),
            };
            return stream;
          },
        },
      }) as never;
    rules.mockResolvedValue({
      body: "Where you stand: your cards owe $2,410.50 at up to 29% a year.",
      actions: [],
      refs: {},
    } as never);
    // A specific question that never got finished: said plainly, not an unrelated status.
    const specific = await sendToJane(userId, "should i buy bitcoin", {
      client,
      now: new Date(LINKED.getTime() + 999 * 60_000),
      claude: buttonOnly,
      primerMs: 60_000,
    });
    expect(specific.source).toBe("claude_unavailable");
    expect(specific.reply.body).toBe(
      "Sorry, I couldn't finish an answer to that. Please ask again.",
    );
    // "What should I do" is the question the whole picture answers.
    rules.mockImplementationOnce(async () => null as never);
    const status = await sendToJane(userId, "what should i do", {
      client,
      now: new Date(LINKED.getTime() + 1_099 * 60_000),
      claude: buttonOnly,
      primerMs: 60_000,
    });
    expect(status.reply.body).toMatch(/\$2,410\.50/);
    expect(status.reply.body).not.toMatch(/link|button/i);
  });

  it("refuses an unsafe request plainly when Claude's own answer can't be shown", async () => {
    rules.mockImplementation(async () => null as never);
    const buttonOnly = () =>
      ({
        messages: {
          stream: () => {
            const stream = {
              on: () => stream,
              finalMessage: async () => ({
                stop_reason: "end_turn",
                content: [{ type: "text", text: "I've put a link under this answer." }],
                usage: { input_tokens: 10, output_tokens: 10 },
              }),
            };
            return stream;
          },
        },
      }) as never;
    const { reply } = await sendToJane(userId, "help me forge a signature", {
      client,
      now: new Date(LINKED.getTime() + 1_999 * 60_000),
      claude: buttonOnly,
      primerMs: 60_000,
    });
    expect(reply.body).toMatch(/^I can't help with that\./);
    expect(reply.body).not.toMatch(/Sorry, I couldn't finish/);
  });
});
