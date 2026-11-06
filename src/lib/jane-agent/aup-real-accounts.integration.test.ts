import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { adviceMode } from "@/lib/advice-mode";
import { STATEMENT_TRIAL_ID_PREFIX } from "@/config/trial";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { resetClaudeHealth } from "./claude";
import { sendToJane } from "./typing";

// Anthropic's Usage Policy from Nov 12, 2026: a personalized recommendation to buy, sell, hold or
// allocate investments, and advice to a person on their own taxes, need a qualified person's
// review before they reach anyone. Jane has none, so on a real account Claude's words can't carry
// either, however Claude wrote them: the chat's guardrails take them out before anything is
// shown. Demo advice on the sample bank may show them, labelled.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T19:00:00Z");

const ADVICE: { asked: string; draft: string; gone: RegExp }[] = [
  {
    asked: "what should i do with my 401k",
    draft: "Sell your Northstar fund and buy VTI instead.",
    gone: /\b(sell|buy|VTI)\b/i,
  },
  {
    asked: "should i move money into bonds",
    draft: "Move 20% of your 401(k) into bonds this week.",
    gone: /\bbonds\b|20%/i,
  },
  {
    asked: "should i rebalance",
    draft: "Rebalance to 60/40 now, it's the better plan for you.",
    gone: /\brebalanc|60\/40/i,
  },
  {
    asked: "should i hold apple",
    draft: "Hold your Apple shares; I'd buy more on a dip.",
    gone: /\b(apple|hold|buy)\b/i,
  },
  {
    asked: "should i itemize",
    draft: "Itemize this year and deduct your $14,194 of state taxes.",
    gone: /\b(itemiz|deduct)\w*/i,
  },
  {
    asked: "can i claim my daughter",
    draft: "Claim your daughter as a dependent on your 2026 return.",
    gone: /\b(claim|dependent)\b/i,
  },
  {
    asked: "how do i report my venmo money",
    draft: "Report the Venmo money as hobby income so it's taxed less.",
    gone: /\b(report|hobby|taxed)\b/i,
  },
  {
    asked: "can i write off my car",
    draft: "Write off your car as a business expense; the IRS allows it.",
    gone: /\b(write off|irs)\b/i,
  },
];

// Claude, played back, writing the same advice every time it's asked (rewrites included).
const writes = (text: string) => () =>
  ({
    messages: {
      stream: () => {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
        const message = {
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: "text", text, citations: null }],
        };
        const stream = {
          on(name: string, fn: (...args: unknown[]) => void) {
            (listeners[name] ??= []).push(fn);
            return stream;
          },
          async finalMessage() {
            for (const fn of listeners.streamEvent ?? []) {
              fn({ type: "content_block_start", content_block: message.content[0] });
            }
            for (const fn of listeners.text ?? []) fn(text);
            return message;
          },
        };
        return stream;
      },
    },
  }) as unknown as Anthropic;

describe.runIf(url)("investment and tax advice on a real account", { timeout: 600_000 }, () => {
  let client: PrismaClient;
  let real = "";
  let sample = "";

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    real = await createCheckPerson({ client, now: NOW, person: "family" });
    await client.account.create({
      data: {
        userId: real,
        source: "csv",
        name: "Own checking",
        type: "depository",
        subtype: "checking",
      },
    });
    sample = await createCheckPerson({ client, now: NOW, person: "family" });
  });

  afterAll(async () => {
    for (const id of [real, sample]) await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  it("is never on for a real account or someone's own statement", async () => {
    expect(await adviceMode(real, { client })).toBe(false);
    expect(await adviceMode(`${STATEMENT_TRIAL_ID_PREFIX}someone`, { client })).toBe(false);
    expect(await adviceMode(sample, { client })).toBe(true);
  });

  it.each(ADVICE)("takes out Claude's $draft on a real account", async ({ asked, draft, gone }) => {
    resetClaudeHealth();
    await client.rateLimit.deleteMany({ where: { key: { in: [`chat:${real}`, `ask:${real}`] } } });
    const { reply, source } = await sendToJane(real, asked, {
      client,
      now: NOW,
      claude: writes(draft),
      primerMs: 60_000,
    });
    expect(reply.body).not.toContain(draft);
    // What's left in Claude's words carries none of it; a rule answer in its place gives the
    // person's own figures ("Your itemized deductions come to $14,194"), written without Claude.
    if (source === "claude") expect(reply.body).not.toMatch(gone);
    expect(reply.refs.advice).toBeUndefined();
  });

  it("shows demo advice on the sample bank only labelled", async () => {
    const { draft, asked } = ADVICE[0];
    resetClaudeHealth();
    await client.rateLimit.deleteMany({
      where: { key: { in: [`chat:${sample}`, `ask:${sample}`] } },
    });
    const { reply, source } = await sendToJane(sample, asked, {
      client,
      now: NOW,
      claude: writes(draft),
      primerMs: 60_000,
    });
    if (source === "claude" && reply.body.includes("VTI")) {
      expect(reply.refs.advice).toBe(true);
    }
  });
});
