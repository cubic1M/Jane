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

  // Debugger 11-02: someone laid off read "Money health: 100 of 100 (Strong)" and "About 40% of what
  // comes in is left after spending": a $12,000 severance in the last three months.
  it("doesn't count a severance as room each month", async () => {
    const user = await client.user.create({
      data: { email: `health-severance-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 300_000,
      },
    });
    const row = (date: string, amountCents: number, description: string, detailed: string) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: `${date}-${description}`,
      date: new Date(`${date}T00:00:00Z`),
      amountCents,
      description,
      merchantName: description,
      pfcPrimary: detailed.split("_").slice(0, -1).join("_") || detailed,
      pfcDetailed: detailed,
      categorySource: "rule" as const,
    });
    const months = ["2026-07", "2026-08", "2026-09"];
    await client.transaction.createMany({
      data: [
        ...months.flatMap((m) => [
          row(`${m}-05`, -180_000, "CA EDD UI", "INCOME_UNEMPLOYMENT"),
          row(`${m}-07`, 340_000, "GREYSTAR RENT", "RENT_AND_UTILITIES_RENT"),
        ]),
        {
          ...row("2026-08-28", -1_200_000, "ACME SEVERANCE", "INCOME_OTHER"),
          pfcPrimary: "INCOME",
        },
      ],
    });
    const view = (await healthFor(user.id, { client, now: NOW }))!;
    const room = view.parts.find((p) => p.part === "margin")!;
    // More goes out than comes in, once the severance is left out.
    expect(room.why).toMatch(/above what came in/);
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
