import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { answerDecision, type Decider } from "./decision";

// The router hands a decision question to the sector that claims its subject, with the
// general facts, and falls back to the general answer when nobody claims it or it declines.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the decision router", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `dr-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, now: NOW, api: {} as never });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const crypto1 = { kind: "decision", item: "crypto", label: "bitcoin" } as const;

  it("gives the subject to the sector that claims it, with the facts and the advice flag", async () => {
    const decide = vi.fn(async () => ({
      body: "Investing's answer.",
      actions: [],
      confidence: { percent: 80, reason: "your balances" },
    }));
    const sectors: Decider[] = [{ decides: ["crypto"], decide }];
    const reply = await answerDecision(userId, crypto1, null, { client, now: NOW, sectors });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        item: "crypto",
        label: "bitcoin",
        advice: true,
        facts: expect.objectContaining({ cardDebtCents: expect.any(Number) }),
      }),
    );
    expect(reply.body).toBe("Investing's answer.\n80% sure: your balances.");
    // Always bound to the topic, and labelled in advice mode.
    expect(reply.refs).toMatchObject({
      advice: true,
      topic: { kind: "decision", category: "crypto", target: "bitcoin" },
    });
  });

  it("answers generally when no sector claims the subject, or the sector declines", async () => {
    const none = await answerDecision(userId, crypto1, null, { client, now: NOW });
    expect(none.body).toContain("here is where you stand");
    const declined = await answerDecision(userId, crypto1, null, {
      client,
      now: NOW,
      sectors: [{ decides: ["crypto"], decide: async () => null }],
    });
    expect(declined.body).toContain("here is where you stand");
    const elsewhere = await answerDecision(userId, crypto1, null, {
      client,
      now: NOW,
      sectors: [{ decides: ["insurance"], decide: async () => ({ body: "no", actions: [] }) }],
    });
    expect(elsewhere.body).not.toBe("no");
  });

  it("uses the last topic for a bare 'should I buy?'", async () => {
    const decide = vi.fn(async () => ({ body: "Yes.", actions: [] }));
    await answerDecision(
      userId,
      { kind: "decision", item: null, label: null },
      { kind: "decision", category: "crypto", target: "bitcoin" },
      { client, now: NOW, sectors: [{ decides: ["crypto"], decide }] },
    );
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ item: "crypto", label: "bitcoin" }),
    );
  });
});
