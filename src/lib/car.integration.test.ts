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
import { loadCar } from "./car";

// Spec step 178 against a real, migrated Postgres, on the demo bank (income from its
// paychecks, gas spending, an auto policy added here): what car the person can afford with
// insurance and running costs in, preapproval offers compared by total cost, a dealer's
// financing checked against them, and nothing for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("buying a car against a real database", { timeout: 120_000 }, () => {
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

  it("works out what car fits their income, with insurance and running costs in", async () => {
    const id = await demoPerson("car-afford");
    const car = await loadCar(id, {}, opts());
    expect(car.available).toBe(true);
    expect(car.monthlyIncomeCents).toBeGreaterThan(100_000);
    expect(car.maxPriceCents).toBeGreaterThan(0);
    const c = car.costs!;
    expect(c.priceCents).toBe(car.comfortPriceCents);
    expect(car.comfortPriceCents).toBeLessThan(car.maxPriceCents!);
    expect(c.allInCents).toBe(
      c.paymentCents + c.insuranceCents + c.fuelCents + c.maintenanceCents + c.registrationCents,
    );
    // Insurance, fuel and upkeep are counted, not just the loan.
    expect(c.insuranceCents).toBeGreaterThan(0);
    expect(c.fuelCents).toBeGreaterThan(0);
    expect(c.allInCents).toBeLessThanOrEqual(car.allowanceCents!);
    expect(car.assumptions.length).toBeGreaterThanOrEqual(5);
    expect(car.assumptions.join(" ")).toMatch(/Fuel: \$[\d,.]+ a month, from your gas spending/);
  });

  it("scales insurance from the person's own auto policy", async () => {
    const id = await demoPerson("car-policy");
    await client.insurancePolicy.deleteMany({ where: { userId: id, kind: "auto" } });
    const without = await loadCar(id, { priceCents: 3_000_000 }, opts());
    expect(without.insuranceFromPolicy).toBe(false);
    // 4% of the price a year when there's no auto policy.
    expect(without.costs!.insuranceCents).toBe(Math.round(120_000 / 12));
    await client.insurancePolicy.create({
      data: {
        userId: id,
        kind: "auto",
        carrier: "Demo Mutual",
        status: "active",
        source: "manual",
        premiumCents: 20_000,
        premiumFrequency: "monthly",
        termMonths: 12,
      },
    });
    const withPolicy = await loadCar(id, { priceCents: 3_000_000 }, opts());
    expect(withPolicy.insuranceFromPolicy).toBe(true);
    // $2,400 a year on the demo bank's $24,500 car, scaled to $30,000.
    expect(withPolicy.costs!.insuranceCents).toBe(
      Math.round(Math.round(240_000 * (3_000_000 / 2_450_000) ** 0.5) / 12),
    );
  });

  it("compares preapprovals by total cost, fees in, cheapest first", async () => {
    const id = await demoPerson("car-offers");
    const car = await loadCar(id, { priceCents: 3_000_000 }, opts());
    expect(car.offers.length).toBeGreaterThan(1);
    const totals = car.offers.map((o) => o.totalCents);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
    expect(car.offers.every((o) => o.offer.product === "auto" && o.offer.demo)).toBe(true);
  });

  it("checks the dealer's financing against the best preapproval", async () => {
    const id = await demoPerson("car-dealer");
    const worse = await loadCar(
      id,
      { priceCents: 3_000_000, dealer: { aprBps: 899, termMonths: 60, feesCents: 0 } },
      opts(),
    );
    expect(worse.dealer!.verdict).toBe("worse");
    expect(worse.dealer!.extraCents).toBeGreaterThan(0);
    const { reply } = await sendToJane(id, "the dealer offered 8.99% for 60 months on $30,000", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^The dealer's financing costs \$[\d,.]+ more than /);
    expect(reply.body).toMatch(/because its rate is 3\.\d\d points higher/);
    expect(parseRefs(reply.refs).advice).toBe(true);
    const good = await loadCar(
      id,
      { priceCents: 3_000_000, dealer: { aprBps: 299, termMonths: 60, feesCents: 0 } },
      opts(),
    );
    expect(good.dealer!.verdict).toBe("better");
  });

  it("answers in the chat and gives Claude the same figures, applying for nothing", async () => {
    const id = await demoPerson("car-chat");
    const { reply } = await sendToJane(id, "how much car can I afford?", { client, now: later() });
    expect(reply.body).toMatch(
      /^A comfortable car for you is around \$[\d,.]+, about \$[\d,.]+ a month all in/,
    );
    expect(reply.body).toMatch(/The cheapest preapproval is /);
    const { reply: priced } = await sendToJane(id, "can I afford a $30,000 car?", {
      client,
      now: later(),
    });
    expect(priced.body).toMatch(/^A \$30,000\.00 car would cost about \$[\d,.]+ a month all in/);
    const tool = JSON.parse(
      (await runChatTool(id, "car_purchase", { price_cents: 3_000_000 }, opts())).content,
    );
    expect(tool.demoAdvice).toBe(true);
    expect(tool.preapprovals.length).toBeGreaterThan(1);
    expect(tool.assumptions.length).toBeGreaterThanOrEqual(5);
    expect(await client.loanApplication.count({ where: { userId: id } })).toBe(0);
  });

  it("prices the most a lender lends when the car is more than any car loan", async () => {
    // A high earner (gap audit: the owner was told there was no lending partner): the
    // comfortable car finances more than the stand-in's car lenders lend.
    const id = await demoPerson("car-rich");
    const account = await client.account.findFirstOrThrow({
      where: { userId: id, type: "depository" },
    });
    await client.transaction.createMany({
      data: ["2026-07-15", "2026-08-15", "2026-09-15"].map((day, i) => ({
        userId: id,
        accountId: account.id,
        source: "plaid",
        plaidTransactionId: `rich-pay-${i}-${id}`,
        date: new Date(`${day}T00:00:00Z`),
        amountCents: -4_000_000,
        description: "BIG CO PAYROLL",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_WAGES",
      })),
    });
    const car = await loadCar(id, {}, opts());
    expect(car.available).toBe(true);
    expect(car.lenderLimitCents).not.toBeNull();
    expect(car.offers.length).toBeGreaterThan(0);
    expect(car.costs!.financedCents).toBe(car.lenderLimitCents);
    expect(car.comfortPriceCents!).toBeGreaterThan(car.costs!.priceCents);
    const { reply } = await sendToJane(id, "how much car can I afford?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/the most the lenders I check would lend for a car is about \$/);
    expect(reply.body).toMatch(/The cheapest preapproval is /);

    // A price no lender takes: the costs still show, with the most a lender would quote.
    const asked = await loadCar(id, { priceCents: 30_000_000 }, opts());
    expect(asked.offers).toEqual([]);
    expect(asked.costs!.priceCents).toBe(30_000_000);
    expect(asked.lenderLimitCents!).toBeLessThan(asked.costs!.financedCents);
    const { reply: priced } = await sendToJane(id, "can I afford a $300,000 car?", {
      client,
      now: later(),
    });
    expect(priced.body).toMatch(/No lender I check lends \$270,000\.00 for a car; the most one/);
    expect(priced.body).not.toMatch(/lending partner/);
  });

  it("gives a real account nothing", async () => {
    const realId = await person("car-real");
    expect((await loadCar(realId, {}, opts())).available).toBe(false);
    const { reply } = await sendToJane(realId, "how much car can I afford?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^Car loan offers come from a lending partner/);
  });
});
