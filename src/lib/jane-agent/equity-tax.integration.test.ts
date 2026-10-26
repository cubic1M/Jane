import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoCrypto } from "@/lib/crypto/crypto";
import { loadEquityIncome } from "@/lib/equity-income";
import { EquityTaxError, addEquityEvent, loadEquityTax, startSetAside } from "@/lib/equity-tax";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 219 against a real, migrated Postgres: crypto lots from the demo exchange's
// buys, an ESPP sale that lost its special treatment, ISOs held (AMT) and RSU withholding
// that falls short, all in the estimate, with a goal for what to set aside.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("crypto and equity pay against a real database", { timeout: 120_000 }, () => {
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

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  const base = {
    grantedOn: null,
    withheldCents: null,
    soldOn: null,
    soldPriceCents: null,
    grantDiscountCents: null,
  } as const;

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

  it("builds lots from the exchange's buys and splits the unrealised gain by how long each is held", async () => {
    const userId = await person("crypto");
    await linkDemoCrypto(userId, "exchange", { client, now: LINKED });
    const income = await loadEquityIncome(userId, 2026, { client, now: LINKED });
    const btc = income.crypto.holdings.find((h) => h.asset === "BTC")!;
    expect(btc.connection).toBe("Demo Exchange");
    // The monthly buys are lots; the rest of the position is the opening lot at the
    // exchange's reported basis: the cost basis is what was paid, and gain = value - basis.
    expect(btc.basisCents).toBeGreaterThan(0);
    expect(btc.gainCents).toBe(btc.valueCents - btc.basisCents);
    expect(btc.shortTermCents + btc.longTermCents).toBe(btc.gainCents);
    expect(income.crypto.yearSales).toEqual([]);
  });

  it("takes a sale off the oldest lot first (the exchange's opening position), long-term, from a source that has sells", async () => {
    const userId = await person("crypto-sell");
    await linkDemoCrypto(userId, "exchange", { client, now: LINKED });
    const source = {
      name: "test",
      readOnly: true as const,
      balances: async () => [],
      trades: async () => [
        {
          date: "2024-02-01",
          asset: "BTC",
          side: "buy" as const,
          amountCents: 1_000_000,
          feeCents: 10_000,
          quantity: 0.02,
        },
        {
          date: "2026-06-01",
          asset: "BTC",
          side: "sell" as const,
          amountCents: 2_100_000,
          feeCents: 10_000,
          quantity: 0.02,
        },
      ],
    };
    const income = await loadEquityIncome(userId, 2026, { client, now: LINKED, source });
    expect(income.crypto.yearSales.filter((s) => s.asset === "BTC")).toEqual([
      expect.objectContaining({
        proceedsCents: 2_090_000,
        costCents: 108_706,
        longTermCents: 1_981_294,
        shortTermCents: 0,
      }),
    ]);
    expect(income.crypto.exchangesSold[0].name).toBe("Demo Exchange");
    // 0.02 of the 0.0425 coins held before the history, at $2,310 for all of them.
    expect(income.longTermGainsCents).toBe(1_981_294);
  });

  it("puts an ESPP sale, ISOs and RSUs in the estimate, with the AMT and the set-aside", async () => {
    const userId = await person("equity");
    const before = await loadTaxEstimate(userId, { client, now: LINKED });
    // A disqualifying ESPP sale this year (sold within 2 years of the offering).
    await addEquityEvent(
      userId,
      {
        ...base,
        kind: "espp",
        company: "Acme",
        shares: 200,
        occurredOn: "2025-03-01",
        grantedOn: "2024-09-01",
        priceCents: 8_500,
        fmvCents: 10_000,
        soldOn: "2026-06-01",
        soldPriceCents: 12_000,
      },
      { client, now: LINKED, via: "page" },
    );
    // ISOs exercised this year and held: an AMT preference.
    await addEquityEvent(
      userId,
      {
        ...base,
        kind: "iso",
        company: "Acme",
        shares: 20_000,
        occurredOn: "2026-02-10",
        priceCents: 200,
        fmvCents: 1_200,
      },
      { client, now: LINKED, via: "page" },
    );
    // RSUs vested this year: withheld at the flat 22%.
    await addEquityEvent(
      userId,
      {
        ...base,
        kind: "rsu",
        company: "Acme",
        shares: 500,
        occurredOn: "2026-05-15",
        priceCents: 0,
        fmvCents: 20_000,
      },
      { client, now: LINKED, via: "page" },
    );

    const after = await loadTaxEstimate(userId, { client, now: LINKED });
    // $1,500 per 100 shares: 200 shares x $15 = $3,000 of ordinary income, in wages.
    expect(after.input.income.wagesCents - before.input.income.wagesCents).toBe(300_000);
    expect(after.input.amtPreferenceCents).toBe(20_000_000);
    expect(after.estimate.amtCents).toBeGreaterThan(0);
    expect(after.estimate.totalTaxCents).toBeGreaterThan(before.estimate.totalTaxCents);
    expect(
      after.assumptions.some((a) =>
        a.startsWith(
          "Options you exercised and still hold count toward the alternative minimum tax",
        ),
      ),
    ).toBe(true);

    const view = await loadEquityTax(userId, { client, now: LINKED });
    expect(view.income.events.find((e) => e.event.kind === "espp")!.espp).toMatchObject({
      qualifying: false,
      ordinaryCents: 300_000,
    });
    expect(view.rsu[0]).toMatchObject({ incomeCents: 10_000_000, withheldCents: 2_200_000 });
    expect(view.rsu[0].shortfallCents).toBeGreaterThanOrEqual(0);
    expect(view.setAside.parts.map((p) => p.label)).toContain(
      "Alternative minimum tax on your ISOs",
    );
    expect(view.setAside.cents).toBe(view.setAside.parts.reduce((s, p) => s + p.cents, 0));

    // The chat brings it up with a goal button; the goal is a tracker and moves nothing.
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey.startsWith("equity:2026"))!;
    expect(candidate.body).toContain("none of it comes out of your paycheck by itself");
    expect(candidate.refs.advice).toBe(true);
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
    const transactionsBefore = await client.transaction.count({ where: { userId } });
    const done = (
      await takeChatAction(userId, message.id, "tax.equity_aside", { client, now: LINKED })
    ).message;
    expect(done.refs.note).toMatch(
      /^Done: "Taxes set aside for equity and crypto 2026" is a goal for \$/,
    );
    expect(await client.transaction.count({ where: { userId } })).toBe(transactionsBefore);
    await expect(startSetAside(userId, { client, now: LINKED, via: "page" })).rejects.toThrow(
      "already started",
    );

    const { reply } = await sendToJane(userId, "how are my ISOs and ESPP taxed", {
      client,
      now: LINKED,
    });
    expect(reply.body).toContain("ESPP sale of 200 Acme shares: a disqualifying sale");
    expect(reply.body).toContain("ISOs exercised (20000 Acme shares)");
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_equity", {}, { client, now: LINKED })).content,
    );
    expect(tool.rsu[0].company).toBe("Acme");
    expect(tool.alternativeMinimumTax).toMatch(/^\$/);
  });

  it("checks what's added", async () => {
    const userId = await person("equity-bad");
    const good = {
      ...base,
      kind: "rsu",
      company: "Acme",
      shares: 10,
      occurredOn: "2026-05-15",
      priceCents: 0,
      fmvCents: 1_000,
    };
    await expect(
      addEquityEvent(userId, { ...good, kind: "bonus" }, { client, now: LINKED, via: "page" }),
    ).rejects.toBeInstanceOf(EquityTaxError);
    await expect(
      addEquityEvent(userId, { ...good, shares: 0 }, { client, now: LINKED, via: "page" }),
    ).rejects.toThrow("number of shares");
    await expect(
      addEquityEvent(
        userId,
        { ...good, occurredOn: "2027-01-01" },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toThrow("day that has passed");
    await expect(
      addEquityEvent(
        userId,
        { ...good, soldOn: "2026-06-01", soldPriceCents: null },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toThrow("price you sold at");
  });

  it("offers no set-aside to real accounts", async () => {
    const real = await client.user.create({
      data: { email: `equity-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await addEquityEvent(
      real.id,
      {
        ...base,
        kind: "iso",
        company: "Acme",
        shares: 20_000,
        occurredOn: "2026-02-10",
        priceCents: 200,
        fmvCents: 1_200,
      },
      { client, now: LINKED, via: "page" },
    );
    await expect(startSetAside(real.id, { client, now: LINKED, via: "page" })).rejects.toThrow(
      "tax professional",
    );
    expect(
      taxesSource
        .gather((await loadSnapshot(real.id, { client, now: LINKED }))!, context)
        .some((c) => c.dedupeKey.startsWith("equity:")),
    ).toBe(false);
  });
});
