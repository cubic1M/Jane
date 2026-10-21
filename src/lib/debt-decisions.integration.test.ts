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
// The "80% sure: ..." line under a decision is the evidence, not part of the answer.
const sentences = (text: string) =>
  text
    .split("\n")
    .filter((l) => !/^\d+% sure:/.test(l))
    .join(" ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

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
      /^A comfortable car for you is around \$[\d,.]+, about \$[\d,.]+ a month all in/,
    );
  });

  it("answers the spending, saving and housing questions in three sentences or fewer, for Maya and Chris", async () => {
    const maya = await client.user.create({
      data: { email: `decisions-maya-${crypto.randomUUID()}@example.com` },
    });
    created.push(maya.id);
    const { itemId } = await linkDemoBank(maya.id, { client, now: NOW, person: "renter" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    for (const who of [maya.id, chris]) {
      for (const q of [
        "how much should I save each month?",
        "should I rent or buy?",
        "can I afford a house?",
        "can I afford a $2,000 vacation?",
        "can I afford a $1,500 laptop?",
        "what subscriptions do I have?",
        "am I spending too much on food?",
        "where does my money go?",
        "how much can I spend this month?",
      ]) {
        const reply = await ask(who, q);
        expect(sentences(reply.body).length, `${q}: ${reply.body}`).toBeLessThanOrEqual(3);
        expect(reply.body, q).not.toMatch(/can't answer that one yet|lending partner/);
      }
    }
    const house = await ask(maya.id, "can I afford a house?");
    expect(house.body).toMatch(/28\/36/);
    expect(house.body).toMatch(/a typical rate|at \d+\.\d\d%/);
    const save = await ask(maya.id, "how much should I save each month?");
    expect(save.body).toMatch(
      /^You keep about \$[\d,.]+ a month now, -?\d+% of the \$[\d,.]+ you take home\./,
    );
    const rent = await ask(maya.id, "should I rent or buy?");
    expect(rent.body).toMatch(/^You pay \$1,450\.00 a month in rent; a home up to /);
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
    expect(reply.body.split("\n")[0]).toBe(
      "I don't see a debt with a balance, so there's nothing to pay down.",
    );
  });
});
