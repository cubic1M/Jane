import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { log } from "@/lib/log";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { resetClaudeHealth } from "./claude";
import { sendToJane } from "./typing";

// Gate E's category check in log mode (manager 11-17): on the chat's own path, a reply it flags
// reaches the person byte for byte as it does with the check off, and only the log and the count
// show it ran.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T19:00:00Z");
// Passes every guardrail, and promises an outcome.
const CLAIM = "Groceries will stay about where they are this month.";

const usage = { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage;
const writes = (text: string) => () =>
  ({
    messages: {
      stream: () => {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
        const block = { type: "text", text, citations: null } as Anthropic.TextBlock;
        const stream = {
          on(name: string, fn: (...args: unknown[]) => void) {
            (listeners[name] ??= []).push(fn);
            return stream;
          },
          async finalMessage() {
            for (const fn of listeners.streamEvent ?? []) {
              fn({ type: "content_block_start", content_block: block });
            }
            for (const fn of listeners.text ?? []) fn(text);
            return { stop_reason: "end_turn", usage, content: [block] };
          },
        };
        return stream;
      },
    },
  }) as unknown as Anthropic;

describe.runIf(url)("the category check on the chat's own path", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: NOW, person: "renter" });
    // A real account: the standard guardrail profile, where gate E counts.
    await client.account.create({
      data: {
        userId: id,
        source: "csv",
        name: "Own checking",
        type: "depository",
        subtype: "checking",
      },
    });
  });

  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.rateLimit.deleteMany({ where: { key: { startsWith: "claimcheck:" } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const ask = async (mode: string, minute: number) => {
    vi.stubEnv("CLAIM_CHECK", mode);
    resetClaudeHealth();
    await client.rateLimit.deleteMany({
      where: { key: { in: [`chat:${id}`, `ask:${id}`, `chatspend:${id}`] } },
    });
    return sendToJane(id, "will my grocery spending change", {
      client,
      now: new Date(NOW.getTime() + minute * 60_000),
      claude: writes(CLAIM),
      primerMs: 60_000,
    });
  };

  it("changes no reply in log mode, and logs and counts what it would have flagged", async () => {
    const json = vi.spyOn(log, "json");
    const off = await ask("off", 0);
    expect(json.mock.calls.filter(([event]) => event === "claim_check")).toEqual([]);
    const logged = await ask("log", 1);
    expect(off.source).toBe("claude");
    expect(logged.source).toBe("claude");
    expect(off.reply.body).toContain(CLAIM);
    expect(logged.reply.body).toBe(off.reply.body);
    expect(logged.reply.actions).toEqual(off.reply.actions);
    expect(json.mock.calls.filter(([event]) => event === "claim_check")).toEqual([
      ["claim_check", { mode: "log", source: "claude", categories: ["outcome"] }],
    ]);
    const counted = await client.rateLimit.findMany({
      where: { key: { startsWith: "claimcheck:" } },
    });
    expect(counted.map((r) => [r.key, r.windowStart.toISOString(), r.count])).toEqual([
      ["claimcheck:claude:outcome", "2026-11-17T00:00:00.000Z", 1],
    ]);
    // Stored as it was sent: the person reads the same words later.
    const stored = await client.janeMessage.findUnique({ where: { id: logged.reply.id } });
    expect(stored?.body).toBe(off.reply.body);
  });
});
