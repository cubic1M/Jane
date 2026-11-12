import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import {
  PRODUCTION_EXPECTED,
  PRODUCTION_NOW,
  newAccountBank,
  productionBank,
  type ProductionBank,
  type SyncResponse,
} from "@/data-sources/plaid/__fixtures__/production";
import { loadInsightTransactions, loadTypicalMonthlySpending } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { homeSummary } from "@/lib/home";
import { loadHubAreas } from "@/lib/hub/load";
import { loadMoneyHub } from "@/lib/hubs/money";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { syncItem } from "./sync";

// Beta accuracy: Plaid production data, hand-built (src/data-sources/plaid/__fixtures__/production.ts),
// through the real sync and the real loaders behind Home, the Money page and the chat's figures.
// Every expected figure is written out by hand in the fixture, never worked out by the code here.
const url = process.env.TEST_DATABASE_URL;
const ASOF = "2026-11-05";
// 3pm and 7pm on Nov 5 in Los Angeles; 7pm is already Nov 6 in UTC.
const AFTERNOON = new Date("2026-11-05T23:00:00Z");
const EVENING = new Date("2026-11-06T03:00:00Z");

describe.runIf(url)("Plaid production data", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person() {
    const user = await client.user.create({
      data: { email: `production-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  // A fake Plaid answering each sync's pages in turn.
  function plaidFor(
    syncs: SyncResponse[][],
    extra: Pick<ProductionBank, "recurring" | "liabilities"> | null,
  ) {
    const pages = syncs.flat();
    let next = 0;
    return {
      transactionsSync: vi.fn(async () => {
        const page = pages[next++];
        if (!page) throw new Error("No more sync pages in the fixture");
        return page;
      }),
      transactionsRecurringGet: vi.fn(async () => ({
        data: extra?.recurring ?? { outflow_streams: [], inflow_streams: [] },
      })),
      liabilitiesGet: vi.fn(async () => ({
        data: extra?.liabilities ?? {
          accounts: [],
          liabilities: { credit: [], mortgage: [], student: [] },
        },
      })),
    } as unknown as PlaidApi;
  }

  async function link(userId: string, name: string) {
    return (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `item-${crypto.randomUUID()}`,
          accessTokenEncrypted: encrypt(`access-production-${name}`),
          institutionName: "Chase",
          liabilities: true,
        },
      })
    ).id;
  }

  async function bankWithThreeSyncs(userId: string) {
    const bank = productionBank(`p${crypto.randomUUID().slice(0, 8)}`);
    const itemId = await link(userId, "one");
    const api = plaidFor(bank.syncs, bank);
    for (let i = 0; i < bank.syncs.length; i += 1) {
      await syncItem(itemId, { client, api, now: PRODUCTION_NOW });
    }
    return bank;
  }

  const months = async (userId: string) =>
    spendingInsights(await loadInsightTransactions(scopedFor(userId, client), ASOF, 4), {
      asOf: ASOF,
      monthCount: 4,
    }).months;
  const byMonth = (rows: { month: string; spendingCents: number; incomeCents: number }[]) => ({
    spendingCents: Object.fromEntries(rows.map((m) => [m.month, m.spendingCents])),
    incomeCents: Object.fromEntries(rows.map((m) => [m.month, m.incomeCents])),
  });

  it("stores each charge once through pending, posting, churn and a settled amount", async () => {
    const userId = await person();
    const bank = productionBank(`p${crypto.randomUUID().slice(0, 8)}`);
    const itemId = await link(userId, "steps");
    const api = plaidFor(bank.syncs, bank);
    const stored = async () =>
      new Map(
        (
          await client.transaction.findMany({
            where: { userId },
            select: { plaidTransactionId: true, amountCents: true, pending: true },
          })
        ).map((t) => [t.plaidTransactionId, t]),
      );

    await syncItem(itemId, { client, api, now: PRODUCTION_NOW });
    const first = await stored();
    expect(first.get(bank.ids("pending-dinner"))).toMatchObject({
      pending: true,
      amountCents: 4000,
    });
    expect(first.get(bank.ids("pending-gas"))).toMatchObject({ pending: true });

    // The second update: dinner posts with its tip and the gas hold goes, each on another page than
    // its other half; a coffee pending and posted since the first sync comes as both at once.
    await syncItem(itemId, { client, api, now: PRODUCTION_NOW });
    const second = await stored();
    expect(second.has(bank.ids("pending-dinner"))).toBe(false);
    expect(second.get(bank.ids("dinner-11"))).toMatchObject({ pending: false, amountCents: 4800 });
    expect(second.has(bank.ids("pending-gas"))).toBe(false);
    expect(second.get(bank.ids("gas-11"))).toMatchObject({ amountCents: 5231 });
    expect(second.get(bank.ids("coffee-11"))).toMatchObject({ pending: false, amountCents: 475 });
    // Never saved beside its posted one, though Plaid lists it as removed only in the next update.
    expect(second.has(bank.ids("pending-coffee"))).toBe(false);
    // Churn: the old id gone, the new one in its place.
    expect(second.has(bank.ids("grocery-10-b"))).toBe(false);
    expect(second.get(bank.ids("grocery-10-b-again"))).toMatchObject({ amountCents: 9560 });

    await syncItem(itemId, { client, api, now: PRODUCTION_NOW });
    const third = await stored();
    expect(third.get(bank.ids("grocery-10-a"))).toMatchObject({ amountCents: 8421 });
    expect(third.size).toBe(PRODUCTION_EXPECTED.rows);
    expect([...third.values()].filter((t) => t.pending)).toEqual([]);
  });

  it("counts spending, income and net worth as worked out by hand", async () => {
    const userId = await person();
    await bankWithThreeSyncs(userId);

    // No transfer between their own accounts, card payment, pending charge or refunded order is
    // spending; refunds net; pay and interest are income, the savings transfers and a friend
    // paying back aren't.
    expect(byMonth(await months(userId))).toEqual({
      spendingCents: PRODUCTION_EXPECTED.spendingCents,
      incomeCents: PRODUCTION_EXPECTED.incomeCents,
    });
    expect((await loadNetWorthHistory(userId, { client, now: PRODUCTION_NOW }))?.todayCents).toBe(
      PRODUCTION_EXPECTED.netWorthCents,
    );
    // August, September and October are full months: their average, refunds netted.
    expect(await loadTypicalMonthlySpending(scopedFor(userId, client), ASOF, PRODUCTION_NOW)).toBe(
      Math.round((118404 + 124097 + 114180) / 3),
    );
  });

  it("finds what the detectors should, at the right figures, and nothing from one charge", async () => {
    const userId = await person();
    await bankWithThreeSyncs(userId);
    const findings = await client.finding.findMany({
      where: { userId },
      select: {
        type: true,
        key: true,
        annualSavingsCents: true,
        amountCents: true,
        evidence: true,
      },
    });
    expect(findings.map((f) => f.type).sort()).toEqual(["idle_cash", "subscription_review"]);
    // Spotify: $11.99 a month, three charges, $143.88 a year.
    expect(findings.find((f) => f.type === "subscription_review")).toMatchObject({
      key: "merchant:spotify",
      annualSavingsCents: 1199 * 12,
    });
    // Idle cash, refunds netted. Checking: $2,850 of rent over the 95 days since Aug 2 (3.1211
    // months) = $913.12. The card: $881.87 bought less the $60 Target return over the 88 days since
    // Aug 9 (2.8912 months) = $284.27. $1,197.39 a month; $6,050 of cash less three months of it.
    const idle = findings.find((f) => f.type === "idle_cash")!;
    expect(idle.evidence).toMatchObject({
      totalBalanceCents: 605000,
      averageMonthlySpendingCents: 119739,
    });
    expect(idle.amountCents).toBe(605000 - 3 * 119739);

    // Plaid's early guess at a monthly stream from one $48 dinner is no bill.
    const home = await homeSummary(userId, { client, now: PRODUCTION_NOW });
    expect(home?.cashFlow.bills).toEqual([
      { merchant: "Spotify", date: "2026-11-12", amountCents: 1199 },
    ]);
    expect(home?.cashFlow.deposits.map((d) => [d.date, d.amountCents])).toEqual([
      ["2026-11-15", 125000],
      ["2026-12-01", 125000],
    ]);
    const money = await loadMoneyArea(userId, { client, now: PRODUCTION_NOW });
    expect(money.recurring.map((r) => [r.merchant, r.annualCostCents])).toEqual([
      ["Spotify", 14388],
    ]);
  });

  it("counts a bank linked twice once: spending, net worth, what's owed, bills and paydays", async () => {
    const userId = await person();
    await bankWithThreeSyncs(userId);
    const before = {
      months: await months(userId),
      worth: (await loadNetWorthHistory(userId, { client, now: PRODUCTION_NOW }))?.todayCents,
      home: await homeSummary(userId, { client, now: PRODUCTION_NOW }),
    };

    // The same bank linked again through Link (not reconnected): a new Item, with new ids for the
    // same accounts and every transaction.
    await bankWithThreeSyncs(userId);
    expect(await client.account.count({ where: { userId } })).toBe(6);

    expect(await months(userId)).toEqual(before.months);
    expect((await loadNetWorthHistory(userId, { client, now: PRODUCTION_NOW }))?.todayCents).toBe(
      before.worth,
    );
    const areas = await loadHubAreas(
      userId,
      { budgetsOver: 0, safeShort: false },
      { client, now: PRODUCTION_NOW },
    );
    expect(areas.loans?.owedCents).toBe(43163);
    expect(areas.loans?.lines).toHaveLength(1);
    const home = await homeSummary(userId, { client, now: PRODUCTION_NOW });
    expect(home?.cashFlow.bills).toEqual(before.home?.cashFlow.bills);
    expect(home?.cashFlow.deposits).toEqual(before.home?.cashFlow.deposits);
    expect(home?.safeToSpend?.safeCents).toBe(before.home?.safeToSpend?.safeCents);
    expect(
      (await client.finding.findMany({ where: { userId }, select: { key: true } })).map(
        (f) => f.key,
      ),
    ).toEqual(expect.arrayContaining(["merchant:spotify", "depository"]));
  });

  it("says nothing it can't know from three weeks of one account", async () => {
    const userId = await person();
    const bank = newAccountBank(`n${crypto.randomUUID().slice(0, 8)}`);
    await syncItem(await link(userId, "new"), {
      client,
      api: plaidFor(bank.syncs, null),
      now: PRODUCTION_NOW,
    });
    expect(byMonth(await months(userId)).spendingCents).toEqual({
      "2026-08": 0,
      "2026-09": 0,
      "2026-10": 1199,
      "2026-11": 4510 + 965,
    });
    // No full month yet: no typical month, rather than three weeks read as one.
    expect(await loadTypicalMonthlySpending(scopedFor(userId, client), ASOF, PRODUCTION_NOW)).toBe(
      0,
    );
    // One Spotify charge isn't a subscription yet, and the money moved in isn't pay.
    expect(await client.finding.count({ where: { userId } })).toBe(0);
    const home = await homeSummary(userId, { client, now: PRODUCTION_NOW });
    expect(home?.cashFlow.bills).toEqual([]);
    expect(home?.safeToSpend).toMatchObject({ payday: null, balanceCents: 43326 });
  });

  it("shows the same figures at 3pm and 7pm in the person's own day", async () => {
    const userId = await person();
    await bankWithThreeSyncs(userId);
    // The figures, not the ids a page links with.
    const figures = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, v) =>
          key === "id" || key.endsWith("Id") || key === "key" ? undefined : v,
        ),
      ) as unknown;
    for (const load of [
      (now: Date) => loadMoneyArea(userId, { client, now }),
      (now: Date) => loadMoneyHub(userId, { client, now }),
      (now: Date) => homeSummary(userId, { client, now }),
      (now: Date) => loadNetWorthHistory(userId, { client, now }),
    ]) {
      expect(figures(await load(EVENING))).toEqual(figures(await load(AFTERNOON)));
    }
  });
});
