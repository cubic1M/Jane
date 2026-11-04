import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { QUESTIONS } from "./checks/bank";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { newPlayed, playbackClaude } from "./checks/real-path";
import { runChatTool } from "./claude-tools";
import { sendToJane } from "./typing";

// 7pm on Oct 31 in Los Angeles is already Nov 1 in UTC. The person's day is Oct 31 (founder,
// 2026-10-23, src/lib/today.ts); the chat's answers and tools count from it, as the pages do.
const NOW = new Date("2026-11-01T02:00:00Z");
const TODAY = "2026-10-31";
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("the chat's day is the person's", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let id: string;
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    id = await createCheckPerson({ client, now: NOW, person: "family" });
  });
  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  const ask = async (text: string) => {
    const q = { ...QUESTIONS[0], id: text, text, tool: undefined, needs: "claude", expect: {} };
    const { reply } = await sendToJane(id, text, {
      client,
      now: NOW,
      claude: playbackClaude(q as (typeof QUESTIONS)[number], newPlayed(), "refused_always"),
      primerMs: 60_000,
    });
    return reply.body;
  };

  it("this month is still October", async () => {
    const body = await ask("whats my spending look like this month");
    expect(body).toContain("October 2026");
    expect(body).not.toContain("November 2026");
  });

  it("counts days from today wherever a date is said", async () => {
    const said: string[] = [];
    for (const text of [
      "how much is my paycheck",
      "how much is safe to spend",
      "whats due",
      "am i ok",
    ]) {
      said.push(await ask(text));
    }
    const dates = said.flatMap((body) => [
      ...body.matchAll(/\b(Nov|Oct) (\d+) \((today|tomorrow|in (\d+) days)\)/g),
    ]);
    expect(dates.length).toBeGreaterThan(0);
    for (const m of dates) {
      const days = Math.round(
        (Date.parse(`2026-${m[1] === "Oct" ? "10" : "11"}-${m[2].padStart(2, "0")}`) -
          Date.parse(TODAY)) /
          86_400_000,
      );
      const word = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      expect(m[0]).toContain(`(${word})`);
    }
  });

  it("gives tools the same day", async () => {
    await client.budget.create({
      data: { userId: id, category: "Food and drink", amountCents: 50_000 },
    });
    const out = JSON.parse((await runChatTool(id, "budgets", {}, { client, now: NOW })).content);
    expect(out.month).toBe("2026-10");
  });

  it("counts the afford answer's days from today too", async () => {
    // 7pm on Sep 15 in Los Angeles.
    const now = new Date("2026-09-16T02:00:00Z");
    const person = await createCheckPerson({ client, now, person: "preretire" });
    try {
      const text = "can i afford a $1500 laptop";
      const q = { ...QUESTIONS[0], id: text, text, tool: undefined, needs: "claude", expect: {} };
      const { reply } = await sendToJane(person, text, {
        client,
        now,
        claude: playbackClaude(q as (typeof QUESTIONS)[number], newPlayed(), "refused_always"),
        primerMs: 60_000,
      });
      const said = reply.body.match(/\bSep (\d+) \(in (\d+) days\)/);
      expect(said, reply.body).not.toBeNull();
      expect(Number(said![2])).toBe(Number(said![1]) - 15);
    } finally {
      await deleteCheckPerson(person, { client }).catch(() => {});
    }
  });

  it("a payment due today, late in the day, is still the next one", async () => {
    // 6pm on Sep 15 in Los Angeles is Sep 16 in UTC. It isn't gone until January yet.
    const now = new Date("2026-09-16T01:00:00Z");
    const freelancer = await createCheckPerson({ client, now, person: "freelancer" });
    try {
      const text = "when is my next quarterly tax payment";
      const q = { ...QUESTIONS[0], id: text, text, tool: undefined, needs: "claude", expect: {} };
      const { reply } = await sendToJane(freelancer, text, {
        client,
        now,
        claude: playbackClaude(q as (typeof QUESTIONS)[number], newPlayed(), "refused_always"),
        primerMs: 60_000,
      });
      expect(reply.body).toContain("Sep 15");
    } finally {
      await deleteCheckPerson(freelancer, { client }).catch(() => {});
    }
  });
});
