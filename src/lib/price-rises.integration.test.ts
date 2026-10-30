import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PRICE_RISE_LEAD_DAYS } from "@/config/price-rises";
import { listDeadlines } from "@/lib/deadlines";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { parseIntent } from "@/lib/jane-agent/intents";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { priceRisesSource } from "@/lib/jane-agent/sources/price-rises";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadPriceRises } from "./price-rises";

// Spec step 243 against a real, migrated Postgres: Priya's demo bank has a fibre bill on an
// intro price and a yearly plan paid once; both raise a deadline at least 30 days ahead, with
// the cheaper choice and the call script, and one heads-up each in the chat.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");
const TODAY = "2026-10-16";
const daysTo = (date: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86_400_000);

describe.runIf(url)("price rises seen before they land", { timeout: 120_000 }, () => {
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

  async function priya() {
    const user = await client.user.create({
      data: { email: `rises-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: "equity" });
    await syncItem(itemId, { client, api, now: NOW });
    return user.id;
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

  it("raises the promo ending as a price rise 30 days ahead or more, and the yearly plan as a renewal", async () => {
    const userId = await priya();
    const rises = await loadPriceRises(userId, { client, now: NOW });
    expect(rises.map((r) => r.kind).sort()).toEqual(["annual_renewal", "promo_end"]);
    const all = await listDeadlines(userId, { client, now: NOW });
    // Under the names the rest of the app gives them (the merchant directory's), so the chat's
    // search finds what a deadline names.
    const deadlines = all.filter((d) => d.kind === "price_rise");
    expect(deadlines.map((d) => d.title)).toEqual(["AT&T: intro price ends"]);
    for (const d of deadlines) {
      expect(daysTo(d.date)).toBeGreaterThanOrEqual(PRICE_RISE_LEAD_DAYS);
      expect(d.detail).toMatch(/Call before/);
      expect(d.chargedOn).toBeDefined();
    }
    // A yearly plan renewing is a renewal (no price rise was seen), listed once.
    const icloud = all.filter((d) => /icloud/i.test(d.title));
    expect(icloud).toHaveLength(1);
    expect(icloud[0].kind).toBe("renewal");
  });

  it("says it in the chat: the rule answer, Claude's tool, and one heads-up each", async () => {
    const userId = await priya();
    expect(parseIntent("when does my intro rate end?", TODAY)).toEqual({ kind: "price_rises" });
    const reply = (await answerByRules(userId, { kind: "price_rises" }, { client, now: NOW }))!;
    expect(reply.body).toMatch(/AT&T's intro price of \$55\.00 a month likely ends/);
    expect(reply.body).toMatch(/What to say on the call/);
    const tool = JSON.parse(
      (await runChatTool(userId, "price_rises", {}, { client, now: NOW })).content,
    );
    expect(tool.rises).toHaveLength(2);
    expect(tool.rises[0].callScript).toBeTruthy();

    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    await postMessages(
      userId,
      gather(snapshot, NOW, { trigger: "open", sources: [priceRisesSource] }),
      { client, now: NOW },
    );
    const messages = await client.janeMessage.findMany({
      where: { userId, dedupeKey: { startsWith: "price_rises:" } },
    });
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.kind === "heads_up")).toBe(true);
    const { message } = await takeChatAction(userId, messages[0].id, "price.called", {
      client,
      now: NOW,
    });
    expect(message.refs.note).toBe("Good. I'll check the next bill to see the price held.");
    // Once each: asking again posts nothing new.
    await postMessages(
      userId,
      gather(snapshot, NOW, { trigger: "open", sources: [priceRisesSource] }),
      { client, now: NOW },
    );
    expect(
      await client.janeMessage.count({
        where: { userId, dedupeKey: { startsWith: "price_rises:" } },
      }),
    ).toBe(2);
  });
});
