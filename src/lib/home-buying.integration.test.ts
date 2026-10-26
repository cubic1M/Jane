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
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { HomeBuyingError, loadHomeBuying, startHomeGoal } from "./home-buying";

// Spec step 179 against a real, migrated Postgres, on the demo bank: what home the person
// can afford from their real income, debts and savings, the cash needed and how long saving
// takes, mortgage offers compared, the down payment goal started only on a tap, and
// nothing for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("buying a home against a real database", { timeout: 120_000 }, () => {
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
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("works out what home fits from real income and debts, with every assumption shown", async () => {
    const id = await demoPerson("home-afford");
    const home = await loadHomeBuying(id, {}, opts());
    expect(home.available).toBe(true);
    const a = home.affordability!;
    expect(a.maxPriceCents).toBeGreaterThan(0);
    expect(home.costs!.housingCents).toBeLessThanOrEqual(a.allowedHousingCents);
    // The rules' limits are shown, with the person's other debt payments taken off.
    expect(a.allowedHousingCents).toBeLessThanOrEqual(a.housingLimitCents);
    expect(home.costs!.pmiCents).toBeGreaterThan(0);
    expect(home.assumptions).toHaveLength(5);
    expect(home.assumptions.join(" ")).toMatch(/your other debt payments are \$[\d,.]+ a month/);
    expect(home.assumptions.join(" ")).toMatch(/take-home divided by 0\.78/);
  });

  it("estimates the cash needed and a saving plan from their real cash flow", async () => {
    const id = await demoPerson("home-saving");
    const home = await loadHomeBuying(id, { priceCents: 40_000_000 }, opts());
    expect(home.costs!.cashNeededCents).toBe(4_000_000 + 1_200_000);
    expect(home.savedCents).toBeGreaterThan(0);
    const s = home.saving!;
    expect(s.stillNeededCents).toBe(Math.max(0, 5_200_000 - home.savedCents));
    expect(s.monthsToTarget).toBe(24);
    expect(s.monthlyNeededCents).toBe(Math.ceil(s.stillNeededCents / 24));
    expect(home.monthlySavingCents).toBeGreaterThanOrEqual(0);
  });

  it("compares mortgage offers by total cost with closing costs, cheapest first", async () => {
    const id = await demoPerson("home-offers");
    const home = await loadHomeBuying(id, { priceCents: 40_000_000 }, opts());
    expect(home.offers.length).toBeGreaterThan(1);
    const totals = home.offers.map((o) => o.totalCents);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
    expect(home.offers.every((o) => o.offer.product === "mortgage" && o.offer.demo)).toBe(true);
  });

  it("answers in the chat, with PMI explained and a goal offered on one tap", async () => {
    const id = await demoPerson("home-chat");
    const { reply } = await sendToJane(id, "can I afford a $400,000 home?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(
      /^A \$400,000\.00 home would cost about \$[\d,.]+ a month with taxes and insurance, (within|over) the /,
    );
    expect(reply.body.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
    expect(reply.body).toMatch(
      /That assumes 10% down \(\$40,000\.00\) on a 30-year loan at \d+\.\d\d%/,
    );
    // Then what you could borrow, measured the other way, in the same sentence (loans QA).
    expect(reply.body).toMatch(
      /so about \$52,000\.00 up front with closing costs(?:; keeping the mortgage payment to a comfortable 30% of your take-home, rather than the 28\/36 rules on your gross pay, borrows about \$[\d,]+\.00 instead)\./,
    );
    expect(parseRefs(reply.refs).advice).toBe(true);
    const goal = parseActions(reply.actions).find((a) => a.id === "home.goal");
    expect(goal?.label).toBe("Start a $52,000.00 down payment goal");
    expect(await client.savingsGoal.count({ where: { userId: id } })).toBe(0);
    const tapped = await takeChatAction(id, reply.id, "home.goal", { client, now: later() });
    expect(tapped.message.refs.note).toMatch(
      /^Started: \$52,000\.00 by \w{3} \d+, 20\d\d\. It's on your goals page/,
    );
    const goals = await client.savingsGoal.findMany({ where: { userId: id } });
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ name: "Home down payment", targetCents: 5_200_000 });
    // Once.
    await expect(startHomeGoal(id, { priceCents: 40_000_000 }, opts())).rejects.toThrow(
      HomeBuyingError,
    );
    expect((await loadHomeBuying(id, {}, opts())).hasGoal).toBe(true);
    const tool = JSON.parse(
      (await runChatTool(id, "home_purchase", { price_cents: 40_000_000 }, opts())).content,
    );
    expect(tool.demoAdvice).toBe(true);
    expect(tool.cashNeeded.total).toBe("$52,000.00");
    expect(tool.saving.goalStarted).toBe(true);
    expect(tool.assumptions).toHaveLength(5);
  });

  it("works the 28/36 math for a real account too, without offers, advice or a made-up rate", async () => {
    const realId = await person("home-real");
    // No income to see yet: nothing to work out, and no goal to start.
    const none = await loadHomeBuying(realId, {}, opts());
    expect(none).toMatchObject({ available: true, missing: "income", advice: false });
    await expect(startHomeGoal(realId, {}, opts())).rejects.toThrow(HomeBuyingError);
    const { reply } = await sendToJane(realId, "how much house can I afford?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^I need a few months of income/);
    expect(await client.savingsGoal.count({ where: { userId: realId } })).toBe(0);
  });
});
