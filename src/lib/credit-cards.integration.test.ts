import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CARD_BETTER_MIN_CENTS } from "@/config/credit-cards";
import { logAudit } from "@/lib/audit";
import { creditCardsSource } from "@/lib/jane-agent/sources/credit-cards";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { setAutopilot } from "@/lib/autopilot";
import { earnsCents } from "@/planning/credit-cards";
import {
  CreditCardError,
  applyForCard,
  creditCardPartnerFor,
  loadCreditCards,
} from "./credit-cards";

// Spec step 174 against a real, migrated Postgres, on the demo bank: what each card earns
// on the person's own year of spending with its fee counted, which card to use for what,
// whether the demo card's $95 fee pays for itself, a card that would earn more applied
// for with one tap, and nothing for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("credit card rewards against a real database", () => {
  let client: PrismaClient;
  let userId: string;
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
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
  const opts = () => ({ client, now: LINKED });
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function demoPerson(prefix: string) {
    const id = await person(prefix);
    const { itemId } = await linkDemoBank(id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await demoPerson("cards-demo");
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("works out what the demo card earns on a year of the person's own spending, fee counted", async () => {
    const cards = await loadCreditCards(userId, opts());
    expect(cards.available).toBe(true);
    expect(cards.firstLook).toBe(false);
    expect(cards.spend.days).toBeGreaterThan(300);
    // Dining, groceries, gas and rides are all there; rent, fees and loans aren't counted.
    for (const kind of ["dining", "groceries", "gas", "travel", "streaming", "online"] as const) {
      expect(cards.spend.byCategory[kind]).toBeGreaterThan(0);
    }
    const [card] = cards.cards;
    expect(card.name).toMatch(/^Demo Credit Card/);
    expect(card.product!.id).toBe("demo-dine-plus");
    expect(card.earnsCents).toBe(earnsCents(card.product!, cards.spend.byCategory) - 9_500);
    expect(cards.wallet.feesCents).toBe(9_500);
    expect(cards.wallet.netCents).toBe(cards.wallet.earnsCents - 9_500);
  });

  it("says the $95 fee doesn't pay for itself, and finds a card that earns more", async () => {
    const cards = await loadCreditCards(userId, opts());
    const fee = cards.cards[0].fee!;
    expect(fee.feeCents).toBe(9_500);
    expect(fee.paysForItself).toBe(false);
    expect(fee.noFee!.card.id).toBe("fern-flat-2");
    expect(fee.noFee!.earnsCents).toBeGreaterThan(fee.netCents);
    expect(cards.better.length).toBeGreaterThan(0);
    expect(cards.better.every((b) => b.gainCents >= CARD_BETTER_MIN_CENTS)).toBe(true);
    // The $550 travel card earns less than its fee on this spending.
    expect(cards.better.some((b) => b.card.id === "summit-premier")).toBe(false);
  });

  it("brings the fee up once a year with one tap to apply, labelled as demo advice", async () => {
    const snapshot = (await loadSnapshot(userId, opts()))!;
    const found = creditCardsSource
      .gather(snapshot, context)
      .filter((c) => c.dedupeKey.startsWith("fee:"));
    expect(found).toHaveLength(1);
    expect(found[0].body).toMatch(
      /^Your Demo Credit Card.*\$95\.00 annual fee doesn't pay for itself/,
    );
    expect(found[0].refs).toMatchObject({
      advice: true,
      creditCard: { productId: expect.any(String) },
    });
    expect(found[0].actions[0]).toMatchObject({ id: "credit_card.apply" });
    expect(found[0].actions[0].label).toMatch(/hard credit check/);
  });

  it("answers which card to use, whether the fee is worth it and the best card, from the rules", async () => {
    const which = await sendToJane(userId, "which card should I use for groceries?", {
      client,
      now: later(),
    });
    expect(which.reply.body).toMatch(/^Use your Demo Credit Card.* for groceries: it earns 1%/);
    expect(parseRefs(which.reply.refs).advice).toBe(true);
    const fee = await sendToJane(userId, "is my annual fee worth it?", { client, now: later() });
    expect(fee.reply.body).toMatch(/\$95\.00 fee\. It doesn't pay for itself/);
    const best = await sendToJane(userId, "what's the best credit card for me?", {
      client,
      now: later(),
    });
    expect(best.reply.body).toMatch(/would add about \$[\d,.]+ a year after its fee/);
    expect(parseActions(best.reply.actions)[0].id).toBe("credit_card.apply");
  });

  it("gives Claude every figure, and applies for nothing", async () => {
    const tool = await runChatTool(userId, "credit_cards", {}, opts());
    const out = JSON.parse(tool.content);
    expect(out.cards[0]).toMatchObject({ annualFee: "$95.00" });
    expect(tool.cents).toContain(9_500);
    expect(out.betterCards.length).toBeGreaterThan(0);
    expect(await client.cardApplication.count({ where: { userId } })).toBe(0);
  });

  it("applies with one tap, audited, never twice, and counts the new card as theirs", async () => {
    const id = await demoPerson("cards-apply");
    const { reply } = await sendToJane(id, "what's the best credit card for me?", {
      client,
      now: later(),
    });
    const best = (await loadCreditCards(id, opts())).better[0];
    const tapped = await takeChatAction(id, reply.id, "credit_card.apply", {
      client,
      now: later(),
    });
    expect(tapped.message.refs.note).toMatch(
      new RegExp(`^Approved: .*${best.card.name} arrives in`),
    );
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id },
      "card_application_submitted",
      expect.objectContaining({ type: "card_application" }),
      expect.objectContaining({ card: best.card.name, status: "approved" }),
    );
    await expect(applyForCard(id, best.card.id, opts())).rejects.toThrow(CreditCardError);
    const after = await loadCreditCards(id, opts());
    expect(after.cards.some((c) => c.fromApplication && c.product!.id === best.card.id)).toBe(true);
    expect(after.better.some((b) => b.card.id === best.card.id)).toBe(false);
    expect(after.wallet.picks.some((p) => p.cardId === best.card.id)).toBe(true);
  });

  it("keeps which card to use for what in the chat by herself from Handle the safe stuff", async () => {
    const id = await demoPerson("cards-safe");
    const best = (await loadCreditCards(id, opts())).better[0];
    await applyForCard(id, best.card.id, opts());
    const picks = async () =>
      creditCardsSource
        .gather((await loadSnapshot(id, opts()))!, context)
        .filter((c) => c.dedupeKey.startsWith("picks:"));
    expect(await picks()).toHaveLength(0);
    await setAutopilot(id, "safe", { client });
    await setSectorAutopilot(id, "debt", { level: "safe" }, { client, now: LINKED });
    const [message] = await picks();
    expect(message.body).toMatch(/^I've worked out which card to use for each kind of spending/);
    expect(message.body).toContain(best.card.name);
  }, 60_000);

  it("never has a catalog, a pick or an application for a real account", async () => {
    const realId = await person("cards-real");
    expect(await creditCardPartnerFor(realId, opts())).toBeNull();
    expect((await loadCreditCards(realId, opts())).available).toBe(false);
    await expect(applyForCard(realId, "fern-flat-2", opts())).rejects.toThrow(CreditCardError);
  });
});
