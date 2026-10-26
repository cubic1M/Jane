import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { cardInterestSource } from "@/lib/jane-agent/sources/card-interest";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  CardInterestError,
  addCardPromo,
  loadCardInterest,
  refreshCardInterest,
  removeCardPromo,
  sendRateRequest,
} from "./card-interest";

// Spec step 224 against a real, migrated Postgres, on the demo bank (a card owing $2,410.50
// at 22.99%, paid about $850 a month): what the cards cost in interest, what paying earlier
// saves, a 0% promotion's pace with a deadline when it's off pace, a request for a lower
// rate sent only on a tap, and nothing for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("less card interest against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
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
  const opts = (now = LINKED) => ({ client, now });
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
  const promo = (over: Partial<Parameters<typeof addCardPromo>[1]> = {}) => ({
    cardName: "Home Goods Store Card",
    balance: "5000",
    startedOn: "2026-06-01",
    endsOn: "2027-02-01",
    goToApr: "26.99",
    deferred: true,
    ...over,
  });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("shows what the card costs in interest and when its statement closes", async () => {
    const id = await demoPerson("int-cards");
    const data = await loadCardInterest(id, opts());
    expect(data.available).toBe(true);
    const card = data.cards.find((c) => c.name.startsWith("Demo Credit Card"))!;
    expect(card).toMatchObject({ balanceCents: 241_050, aprBps: 2_299 });
    expect(card.interestYearCents).toBe(55_417);
    expect(data.interestYearCents).toBe(55_417);
    expect(card.statementClosesOn).toBe("2026-11-01");
    expect(card.rate!.newAprBps).toBe(1_999);
    expect(card.rate!.savingYearlyCents).toBe(7_232);
    expect(card.rate!.sent).toBeNull();
  });

  it("raises a deadline with the monthly amount when a deferred promotion is off pace", async () => {
    const id = await demoPerson("int-promo");
    await expect(addCardPromo(id, promo({ cardName: "" }), opts())).rejects.toThrow(
      CardInterestError,
    );
    await expect(addCardPromo(id, promo({ endsOn: "2026-05-01" }), opts())).rejects.toThrow(
      CardInterestError,
    );
    await addCardPromo(id, promo(), opts());
    const data = await loadCardInterest(id, opts());
    const p = data.promos[0];
    expect(p.plan.onPace).toBe(false);
    expect(p.plan.monthlyNeededCents).toBeGreaterThan(p.plan.monthlyPaidCents);
    expect(p.deadlineRaised).toBe(true);
    const deadline = await client.deadline.findFirstOrThrow({ where: { userId: id } });
    expect(deadline.title).toBe("Home Goods Store Card: clear the 0% balance by 2027-02-01");
    expect(deadline.dueOn.toISOString().slice(0, 10)).toBe("2027-02-01");
    expect(deadline.note).toContain(
      `Pay ${(p.plan.monthlyNeededCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} a month`,
    );
    expect(deadline.note).toContain("interest from the start at 26.99% is charged");
    // Once, even after another refresh.
    await refreshCardInterest(id, opts());
    expect(await client.deadline.count({ where: { userId: id } })).toBe(1);
    const snapshot = (await loadSnapshot(id, opts()))!;
    const warn = cardInterestSource
      .gather(snapshot, context)
      .find((c) => c.dedupeKey.startsWith("promo:"))!;
    expect(warn.body).toMatch(
      /^Home Goods Store Card's 0% ends in 106 days and you're \$[\d,.]+ a month short/,
    );
    await removeCardPromo(id, p.id, opts());
    expect(
      (await client.deadline.findFirstOrThrow({ where: { userId: id } })).doneAt,
    ).not.toBeNull();
  });

  it("raises no deadline for a promotion on pace", async () => {
    const id = await demoPerson("int-pace");
    await addCardPromo(id, promo({ balance: "900", deferred: false }), opts());
    const p = (await loadCardInterest(id, opts())).promos[0];
    expect(p.plan.onPace).toBe(true);
    expect(await client.deadline.count({ where: { userId: id } })).toBe(0);
  });

  it("sends a request for a lower rate only on a tap, once a month, and the lender answers", async () => {
    const id = await demoPerson("int-rate");
    const { reply } = await sendToJane(id, "how much interest am I paying on my cards?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(
      /^Your cards cost about \$554\.17 a year in interest at today's balances\./,
    );
    expect(reply.body).toMatch(/could save about \$72\.32 a year/);
    expect(parseActions(reply.actions)[0].id).toBe("cardrate.send");
    expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(0);
    const tapped = await takeChatAction(id, reply.id, "cardrate.send", { client, now: later() });
    expect(tapped.message.refs.note).toMatch(/^Sent to Demo Credit Card/);
    const row = await client.cardRateRequest.findFirstOrThrow({ where: { userId: id } });
    expect(row).toMatchObject({
      status: "sent",
      oldAprBps: 2_299,
      savingYearlyCents: 7_232,
      partner: "demo",
    });
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id },
      "card_rate_requested",
      expect.objectContaining({ type: "card_rate_request" }),
      expect.objectContaining({ from_bps: 2_299 }),
    );
    await expect(sendRateRequest(id, row.key, opts())).rejects.toThrow(CardInterestError);
    expect((await refreshCardInterest(id, opts())).answered).toBe(0);
    const after = new Date(LINKED.getTime() + 3 * DAY);
    expect((await refreshCardInterest(id, opts(after))).answered).toBe(1);
    const answered = await client.cardRateRequest.findFirstOrThrow({ where: { userId: id } });
    expect(["granted", "declined"]).toContain(answered.status);
    expect(answered.outcome).toMatch(/^(Approved|Declined):/);
    if (answered.status === "granted") expect(answered.newAprBps).toBe(1_999);
    const snapshot = (await loadSnapshot(id, opts(after)))!;
    const note = cardInterestSource
      .gather(snapshot, { ...context, now: after })
      .find((c) => c.dedupeKey.startsWith("cardrate_answer:"));
    expect(note).toBeDefined();
    const tool = JSON.parse((await runChatTool(id, "card_interest", {}, opts(after))).content);
    expect(tool.alwaysNeedsATap).toBe("sending any request");
    expect(tool.cards[0].lowerRateRequest.callScript).toContain("Call the number on the back");
  });

  it("never touches a real account", async () => {
    const realId = await person("int-real");
    expect((await loadCardInterest(realId, opts())).available).toBe(false);
    await expect(addCardPromo(realId, promo(), opts())).rejects.toThrow(CardInterestError);
    await expect(sendRateRequest(realId, "account:x", opts())).rejects.toThrow(CardInterestError);
    const { reply } = await sendToJane(realId, "how much interest am I paying on my cards?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^Cutting card interest needs a lending partner/);
  });
});
