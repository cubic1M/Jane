import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CHAT_SOURCE_MONTHLY_LIMITS } from "@/config/agent-chat";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxFound } from "@/lib/tax-scan";
import { runChatTool } from "./claude-tools";
import { runJaneAgent } from "./run";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 273 against a real, migrated Postgres: every tax detector's suggestion on the tax
// calendar, ranked with the rest of the scan, and taxes speaking at most once a month in the
// chat unless something is urgent.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const COUNTED = ["decision", "done", "heads_up"];
const { urgentFrom } = CHAT_SOURCE_MONTHLY_LIMITS.taxes;

describe.runIf(url)("taxes on autopilot, round three", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    // Social Security coming in, so there is more than one thing to say about taxes.
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    for (let m = 0; m < 12; m++) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date(Date.UTC(2025, 10 + m, 3)),
          amountCents: -268_000,
          description: "SSA TREAS 310 XXSOC SEC",
          pfcDetailed: "INCOME_OTHER",
        },
      });
    }
    return user.id;
  }
  const taxMessages = (userId: string) =>
    client.janeMessage.findMany({
      where: { userId, dedupeKey: { startsWith: "taxes:" }, kind: { in: COUNTED } },
      select: { dedupeKey: true },
    });
  const priorities = async (userId: string, now: Date) =>
    new Map(
      taxesSource
        .gather((await loadSnapshot(userId, { client, now }))!, {
          now,
          local: { date: now.toISOString().slice(0, 10), hour: 9 },
          trigger: "open",
        })
        .map((c) => [`taxes:${c.dedupeKey}`, c.priority]),
    );

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

  it("puts every tax suggestion from the scan on the calendar, ranked with the rest", async () => {
    const userId = await person("ap3");
    const found = await loadTaxFound(userId, { client, now: LINKED });
    expect(found.map((f) => f.topic)).toContain("social_security_tax");
    for (const f of found) {
      expect(f.rank).toBeGreaterThanOrEqual(1);
      expect(f.month).toBeGreaterThanOrEqual(1);
      expect(f.month).toBeLessThanOrEqual(12);
    }
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_calendar", {}, { client, now: LINKED })).content,
    );
    expect(tool.foundForThem.map((f: { what: string }) => f.what)).toContain(
      found.find((f) => f.topic === "social_security_tax")!.headline,
    );
    const { reply } = await sendToJane(userId, "what's happening with my taxes this month", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(/^Here is your tax calendar for October\./);
  });

  it("says one thing about taxes a month, and only what's urgent after that", async () => {
    const userId = await person("ap3-month");
    const day1 = new Date("2026-10-19T14:00:00Z");
    await runJaneAgent(userId, { client, now: day1, trigger: "open" });
    const p1 = await priorities(userId, day1);
    const first = (await taxMessages(userId)).map((m) => m.dedupeKey);
    expect(first.filter((k) => (p1.get(k) ?? 0) < urgentFrom).length).toBeLessThanOrEqual(1);

    const day2 = new Date("2026-10-20T14:00:00Z");
    await runJaneAgent(userId, { client, now: day2, trigger: "open" });
    const p2 = await priorities(userId, day2);
    const later = (await taxMessages(userId))
      .map((m) => m.dedupeKey)
      .filter((k) => !first.includes(k));
    if (first.length > 0) expect(later.filter((k) => (p2.get(k) ?? 0) < urgentFrom)).toEqual([]);
  });
});
