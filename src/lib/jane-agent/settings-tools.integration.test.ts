import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { CHAT_PAGES, proposeAction, runChatTool } from "./claude-tools";

// Gap audit (settings, connected banks, notifications) against a real, migrated Postgres: the
// chat can say which banks are linked and whether one needs signing in again, what Jane sends
// and how, and link to each settings page, documents, things you own and the household. Nothing
// in the output is a token or a full account number.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("settings in the chat against a real database", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `settings-tools-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("says which banks are linked, and when one needs signing in again", async () => {
    const run = async () =>
      JSON.parse((await runChatTool(userId, "connections", {}, { client, now: NOW })).content);
    const before = await run();
    expect(before.banks).toHaveLength(1);
    expect(before.banks[0]).toMatchObject({ sampleData: true, needsSigningInAgain: false });
    expect(before.banks[0].accounts.join(" ")).toMatch(/····\d{4}/);
    await client.plaidItem.updateMany({ where: { userId }, data: { status: "login_required" } });
    expect((await run()).banks[0].needsSigningInAgain).toBe(true);
    const raw = (await runChatTool(userId, "connections", {}, { client, now: NOW })).content;
    expect(raw).not.toMatch(/access|token|demo-[0-9a-f]{8}/i);
  });

  it("says what Jane sends and how, and that settings change it", async () => {
    await client.user.update({ where: { id: userId }, data: { digestEnabled: false } });
    const out = JSON.parse(
      (await runChatTool(userId, "notification_settings", {}, { client, now: NOW })).content,
    );
    expect(out).toMatchObject({
      tryingJaneWithSampleData: false,
      weeklyEmailAndMonthlyReport: false,
      twoFactorOn: false,
      calendarLinkMade: false,
    });
    expect(out.alerts.length).toBeGreaterThan(5);
    expect(out.janesMessages.atMostADay).toBeGreaterThan(0);
  });

  it("links to each settings page, documents, things you own and the household", async () => {
    for (const page of [
      "two_factor",
      "your_data",
      "delete_data",
      "documents",
      "things",
      "household",
    ]) {
      const p = await proposeAction(userId, { action: "open", page }, { client, now: NOW });
      expect(p, page).toMatchObject({ ok: true });
      expect((p as { actions: { href: string }[] }).actions[0].href).toBe(CHAT_PAGES[page].href);
    }
  });
});
