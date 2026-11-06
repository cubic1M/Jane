import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { adviceMode } from "@/lib/advice-mode";
import { QUESTIONS } from "./checks/bank";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { newPlayed, playbackClaude } from "./checks/real-path";
import { resetClaudeHealth } from "./claude";
import { sendToJane } from "./typing";

// The chat's own path, with Claude played back: an answer Claude wrote after looking up the
// person's investments or taxes carries refs.aiWritten (the chat shows AI_WRITTEN_LABEL), on the
// sample bank and on a real account alike; one about groceries doesn't.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T19:00:00Z");

describe.runIf(url)("the AI note on the chat's own path", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  const ask = async (id: string, text: string, tool: string | undefined) => {
    resetClaudeHealth();
    const q = { ...QUESTIONS[0], id: text, text, tool, needs: "claude", expect: {} };
    const sent = await sendToJane(id, text, {
      client,
      now: NOW,
      claude: playbackClaude(q as (typeof QUESTIONS)[number], newPlayed(), "plain"),
      primerMs: 60_000,
    });
    return sent;
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    for (const id of made) await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  it.each([
    ["the sample bank", false],
    ["a real account", true],
  ])("is on an investing or tax answer on %s, and not on groceries", async (_, real) => {
    const id = await createCheckPerson({ client, now: NOW, person: "preretire" });
    made.push(id);
    if (real) {
      await client.account.create({
        data: {
          userId: id,
          source: "csv",
          name: "Own checking",
          type: "depository",
          subtype: "checking",
        },
      });
    }
    expect(await adviceMode(id, { client })).toBe(!real);
    // First, in a fresh chat: a follow-up to a tax answer is looked up with the tax tools too, and
    // says so, which is the safe way round.
    const groceries = await ask(id, "how much did i spend on groceries", "spending_by_category");
    expect(groceries.source).toBe("claude");
    expect(groceries.reply.refs.aiWritten).toBeUndefined();
    const investing = await ask(id, "what's in my 401k", "holdings");
    expect(investing.source).toBe("claude");
    expect(investing.reply.refs.aiWritten).toBe(true);
    const taxes = await ask(id, "how much tax will i owe", "tax_estimate");
    expect(taxes.source).toBe("claude");
    expect(taxes.reply.refs.aiWritten).toBe(true);
  });
});
