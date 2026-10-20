import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadDetectionInput } from "@/detection/engine";
import { unusualAlerts } from "@/detection/unusual";
import { raiseAlerts } from "@/lib/alerts";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { gather } from "@/lib/jane-agent/brain";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { unusualSource } from "@/lib/jane-agent/sources/unusual";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaught, missingRefundAlerts } from "./unusual";

// Spec step 208 against a real, migrated Postgres, with the demo bank: an unusually large
// first charge becomes one alert with two buttons in the chat; "this was me" teaches the
// merchant, "not me" opens a dispute card and gives the steps to lock the card.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("spotting the unusual", { timeout: 120_000 }, () => {
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

  async function person(prefix: string, description: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    const account = await client.account.findFirstOrThrow({
      where: { userId: user.id, type: "credit" },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        date: new Date("2026-10-15T00:00:00Z"),
        description,
        merchantName: description,
        amountCents: 120_000,
        pfcPrimary: "GENERAL_MERCHANDISE",
      },
    });
    return user.id;
  }

  async function raise(userId: string) {
    const input = await loadDetectionInput(userId, { client, now: NOW });
    const alerts = unusualAlerts(input, undefined, await loadTaught(userId, { client }));
    await raiseAlerts(userId, alerts, { client, now: NOW, send: vi.fn(), push: vi.fn() });
    return alerts;
  }

  async function ask(userId: string) {
    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    await postMessages(
      userId,
      gather(snapshot, NOW, { trigger: "open", sources: [unusualSource] }),
      { client, now: NOW },
    );
    return client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "unusual:" }, body: { contains: "ZENITH" } },
    });
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("asks once, and 'this was me' teaches the merchant", async () => {
    const userId = await person("unusual-me", "ZENITH JEWELLERS");
    const zenith = (alerts: { title: string }[]) =>
      alerts.filter((a) => a.title.includes("ZENITH")).map((a) => a.title);
    expect(zenith(await raise(userId))).toEqual(["$1,200.00 at ZENITH JEWELLERS, a first charge"]);
    expect(
      await client.alert.count({
        where: { userId, type: "unusual_activity", title: { contains: "ZENITH" } },
      }),
    ).toBe(1);
    const message = await ask(userId);
    expect(message.body).toMatch(
      /^\$1,200\.00 at ZENITH JEWELLERS, a first charge\. On Oct 15\. .* Was this you\?$/,
    );
    expect(message.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unusual.me", label: "This was me" }),
        expect.objectContaining({ id: "unusual.not_me", label: "Not me" }),
      ]),
    );
    const { message: answered } = await takeChatAction(userId, message.id, "unusual.me", {
      client,
      now: NOW,
    });
    expect(answered.refs.note).toMatch(/won't flag that merchant again/);
    expect((await loadTaught(userId, { client })).size).toBe(1);
    // Taught: the same merchant stays quiet, and rescans raise nothing more.
    expect(zenith(await raise(userId))).toEqual([]);
    expect(
      await client.alert.count({
        where: { userId, type: "unusual_activity", title: { contains: "ZENITH" } },
      }),
    ).toBe(1);
  });

  it("'not me' opens a dispute card and gives the steps to lock the card", async () => {
    const userId = await person("unusual-not", "ZENITH JEWELLERS");
    await raise(userId);
    const message = await ask(userId);
    const { message: answered } = await takeChatAction(userId, message.id, "unusual.not_me", {
      client,
      now: NOW,
    });
    expect(answered.body).toMatch(/lock the card/);
    expect(answered.body).toContain("1. Open your card issuer's app or site and lock the card");
    const finding = await client.finding.findFirstOrThrow({
      where: { userId, key: { startsWith: "unusual:" } },
    });
    expect(finding).toMatchObject({
      type: "duplicate_charge",
      status: "new",
      amountCents: 120_000,
    });
    // Not taught: it would still be flagged.
    expect((await loadTaught(userId, { client })).size).toBe(0);
    // Answered once only.
    await expect(
      takeChatAction(userId, message.id, "unusual.me", { client, now: NOW }),
    ).rejects.toBeDefined();
  });

  it("raises a refund that never arrived", async () => {
    const userId = await person("unusual-refund", "ZENITH JEWELLERS");
    const finding = await client.finding.create({
      data: {
        userId,
        type: "duplicate_charge",
        key: `k-${crypto.randomUUID()}`,
        title: "Charged twice at Target",
        annualSavingsCents: 6_420,
        confidence: "high",
        evidence: {},
        status: "approved",
      },
    });
    const decision = await client.decision.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: { title: "Charged twice at Target" },
      },
    });
    await client.action.create({
      data: {
        userId,
        decisionId: decision.id,
        type: "request_refund",
        status: "done",
        refundCents: 6_420,
        completedAt: new Date("2026-09-20T12:00:00Z"),
      },
    });
    expect((await missingRefundAlerts(userId, { client, now: NOW })).map((a) => a.title)).toEqual([
      "$64.20 refund hasn't arrived",
    ]);
    // Not yet due, or already seen: nothing.
    expect(
      await missingRefundAlerts(userId, { client, now: new Date("2026-09-25T00:00:00Z") }),
    ).toEqual([]);
    await client.action.updateMany({ where: { userId }, data: { refundSeenAt: NOW } });
    expect(await missingRefundAlerts(userId, { client, now: NOW })).toEqual([]);
  });
});
