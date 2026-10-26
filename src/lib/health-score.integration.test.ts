import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { HEALTH_NEVER_SAY, HEALTH_WEIGHTS } from "@/config/health-score";
import { answerByRules } from "@/lib/jane-agent/answer";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { healthFor, healthOfMonth } from "./health-score";

// Spec step 146 against a real, migrated Postgres, with the demo bank: a score out of 100
// from the person's own numbers, each part explained, kept for the month by Jane's run
// (not by reading it), compared with last month, and the same in the chat and for Claude.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("money health score", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("scores the demo person's money, explains it, and keeps the month", async () => {
    const user = await client.user.create({
      data: { email: `health-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });

    const view = (await healthFor(user.id, { client, now: NOW }))!;
    expect(view.month).toBe("2026-10");
    expect(view.score).toBeGreaterThanOrEqual(0);
    expect(view.score).toBeLessThanOrEqual(100);
    expect(view.parts.map((p) => p.part)).toEqual(
      expect.arrayContaining(["cushion", "margin", "onTime", "cards"]),
    );
    for (const p of view.parts) {
      expect(p.max).toBe(HEALTH_WEIGHTS[p.part]);
      expect(p.why).not.toBe("");
    }
    // The demo has no goals yet: left out, not counted against the person.
    expect(view.left.map((l) => l.part)).toContain("goals");
    // Reading doesn't keep it; Jane's run does (the sync ran it once already).
    expect(await healthOfMonth(user.id, "2026-10", { client })).not.toBeNull();
    await client.healthScore.deleteMany({ where: { userId: user.id } });
    await healthFor(user.id, { client, now: NOW });
    expect(await healthOfMonth(user.id, "2026-10", { client })).toBeNull();
    await healthFor(user.id, { client, now: NOW, keep: true });
    expect(await healthOfMonth(user.id, "2026-10", { client })).toMatchObject({
      score: view.score,
      band: view.band,
    });
    await healthFor(user.id, { client, now: NOW, keep: true });
    expect(await client.healthScore.count({ where: { userId: user.id } })).toBe(1);

    // Last month's score: the change and what moved it.
    await client.healthScore.create({
      data: {
        userId: user.id,
        month: "2026-09",
        score: view.score - 7,
        band: "Steady",
        parts: view.parts.map((p) => (p.part === "cushion" ? { ...p, points: p.points - 7 } : p)),
      },
    });
    const later = (await healthFor(user.id, { client, now: NOW }))!;
    expect(later.change).toEqual({ delta: 7, biggest: { label: "Cash cushion", delta: 7 } });

    const reply = (await answerByRules(user.id, { kind: "health" }, { client, now: NOW }))!;
    expect(reply.body).toMatch(
      new RegExp(
        `^Your money health score is ${view.score} out of 100 \\(${view.band}\\)\\. That's up 7 since September, mostly from cash cushion\\.`,
      ),
    );
    expect(reply.body).not.toMatch(HEALTH_NEVER_SAY);
    const tool = JSON.parse(
      (await runChatTool(user.id, "health_score", {}, { client, now: NOW })).content,
    );
    expect(tool).toMatchObject({
      score: view.score,
      lastMonth: { month: "2026-09", change: 7, mostlyFrom: "Cash cushion" },
    });
  });

  it("has nothing to score before accounts are linked", async () => {
    const user = await client.user.create({
      data: { email: `health-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    expect(await healthFor(user.id, { client, now: NOW, keep: true })).toBeNull();
    expect(await client.healthScore.count({ where: { userId: user.id } })).toBe(0);
  });
});
