import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadDecisionInput } from "./debt-decisions";

// Straight answers to debt and credit decisions against a real, migrated Postgres, on Chris's
// demo bank (cards at high rates, a car loan, little cash): each answer is three sentences or
// fewer, built from his own numbers, and picks only in demo advice mode.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

describe.runIf(url)("debt decisions against a real database", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let chris: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  let tick = 0;
  const later = () => new Date(NOW.getTime() + ++tick * MINUTE);
  const ask = async (userId: string, text: string) =>
    (await sendToJane(userId, text, { client, now: later() })).reply;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `decisions-${crypto.randomUUID()}@example.com` },
    });
    chris = user.id;
    created.push(chris);
    const { itemId } = await linkDemoBank(chris, { client, now: NOW, person: "debt" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("reads Chris's own numbers", async () => {
    const i = await loadDecisionInput(chris, { client, now: NOW });
    expect(i.advice).toBe(true);
    expect(i.cards.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...i.cards.map((c) => c.aprBps ?? 0))).toBeGreaterThan(2_500);
    expect(i.liquidCents).toBeGreaterThanOrEqual(0);
    expect(i.monthlySpendCents).toBeGreaterThan(100_000);
  });

  it("answers each decision in three sentences or fewer, with the demo advice label", async () => {
    for (const q of [
      "should I pay off my card or invest?",
      "should I consolidate my debt?",
      "should I use my savings to pay off my cards?",
      "should I close a credit card?",
      "will paying off my card hurt my credit?",
      "should I take a personal loan to pay off my cards?",
      "should I take a payday loan?",
    ]) {
      const reply = await ask(chris, q);
      expect(sentences(reply.body).length, `${q}: ${reply.body}`).toBeLessThanOrEqual(3);
      expect(reply.body, q).not.toMatch(/can't answer that one yet/);
      expect(
        reply.actions.some((a) => a.kind === "link" && a.href.startsWith("/loans")),
        q,
      ).toBe(true);
    }
    const pay = await ask(chris, "should I pay off my card or invest?");
    expect(pay.body).toMatch(/^.+ costs \d+(\.\d+)?% a year on \$[\d,]+\.\d\d, and investing has/);
    expect(pay.body).toContain("so I'd pay it off first");
    expect(parseRefs(pay.refs).advice).toBe(true);
    const payday = await ask(chris, "should I take a payday loan?");
    expect(payday.body).toContain("around 391% a year");
  });

  it("answers the overdraft, buy now pay later and car questions in three sentences or fewer", async () => {
    for (const q of [
      "will I overdraft this month?",
      "should I use buy now pay later?",
      "can I afford a car?",
    ]) {
      const reply = await ask(chris, q);
      expect(sentences(reply.body).length, `${q}: ${reply.body}`).toBeLessThanOrEqual(3);
      expect(reply.body, q).not.toMatch(/can't answer that one yet/);
    }
    expect((await ask(chris, "should I use buy now pay later?")).body).toMatch(
      /^A Pay in 4 plan costs nothing extra/,
    );
    expect((await ask(chris, "can I afford a car?")).body).toMatch(
      /^You can afford a car up to about \$[\d,.]+, keeping the all-in cost under /,
    );
  });

  it("is the same answer through Claude's tool, with the figures recorded", async () => {
    const out = await runChatTool(
      chris,
      "debt_decision",
      { which: "pay_or_invest" },
      {
        client,
        now: NOW,
      },
    );
    const tool = JSON.parse(out.content);
    expect(tool.answer).toHaveLength(3);
    expect(tool.demoAdvice).toBe(true);
    expect(out.cents.length).toBeGreaterThan(0);
    const bad = await runChatTool(chris, "debt_decision", { which: "nope" }, { client, now: NOW });
    expect(JSON.parse(bad.content).error).toMatch(/Pick one/);
  });

  it("says nothing to pay down for someone with no debt", async () => {
    const user = await client.user.create({
      data: { email: `decisions-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const reply = await ask(user.id, "should I pay off my card or invest?");
    expect(reply.body).toBe("I don't see a debt with a balance, so there's nothing to pay down.");
  });
});
