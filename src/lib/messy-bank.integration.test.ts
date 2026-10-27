import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { THIN_DATA_MAX_PERCENT, THIN_DATA_MAX_PER_MONTH } from "@/config/detection";
import {
  plaidAccount,
  plaidApiError,
  plaidTransaction,
  syncPage,
} from "@/data-sources/plaid/__fixtures__/plaid";
import { isFirstDetectionComplete, loadDetectionInput, runDetection } from "@/detection/engine";
import { forecastAccounts, upcomingBills } from "@/detection/forecast";
import { recurringCharges } from "@/detection/subscriptions";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { importCsvFiles } from "@/lib/import/import-csv";
import { syncItem } from "@/lib/plaid/sync";
import { detectFor } from "@/lib/suggestions";

// A messy real bank (founder, 2026-10-26: "make Jane hold up on messy real bank data before
// real accounts link"). Every finding had been tuned on the eight sample people; this person
// has what real exports have: card payments written by the card company, transfers to their
// own savings and to themselves on Venmo and Zelle, a refunded fee, a cancelled flight and a
// return, processor prefixes ("SQ *", "TST*", "PAYPAL *", "AMZN Mktp US*"), a subscription
// whose price went up and a yearly one, uneven paychecks and freelance payouts, a trip abroad,
// one big purchase, two card exports that overlap by a month, and under four months of history.
// The CSV files are e2e/fixtures/messy (the e2e uploads the same ones). A second person comes
// through Plaid: pending charges that post at a different amount or date, and a foreign-currency
// row. Runs against a real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-21T16:00:00Z");
const TODAY = "2026-10-21";
const file = (name: string) => ({
  name,
  text: readFileSync(`e2e/fixtures/messy/${name}`, "utf8"),
});
// Things that move the person's own money, never spending or income, and never a bill.
const MOVING_MONEY = /autopay|transfer|venmo|zelle|thank you|cashout/i;

describe.runIf(url)("a messy real bank, through the CSV import", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const imported: { inserted: number; duplicates: number }[] = [];

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `messy-csv-${crypto.randomUUID()}@example.com` } })
    ).id;
    const account = (name: string, type: string, subtype: string, balance: number) =>
      client.account.create({
        data: { userId, source: "csv", name, type, subtype, currentBalanceCents: balance },
      });
    const checking = await account("Chase Checking", "depository", "checking", 287_533);
    const savings = await account("Chase Savings", "depository", "savings", 614_026);
    const card = await account("Chase Freedom", "credit", "credit card", 41_210);
    const db = scopedFor(userId, client) as unknown as Parameters<typeof importCsvFiles>[0];
    imported.push(await importCsvFiles(db, checking.id, [file("checking.csv")]));
    imported.push(await importCsvFiles(db, savings.id, [file("savings.csv")]));
    imported.push(await importCsvFiles(db, card.id, [file("card-jul-sep.csv")]));
    // The second export overlaps the first by a month: its shared rows are skipped.
    imported.push(await importCsvFiles(db, card.id, [file("card-aug-oct.csv")]));
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("keeps one copy of each row from overlapping exports", () => {
    expect(imported.map((i) => i.inserted)).toEqual([37, 9, 69, 28]);
    expect(imported[3].duplicates).toBe(28);
  });

  it("counts no transfer or card payment as spending or income, and nets refunds", async () => {
    const txs = await loadInsightTransactions(scopedFor(userId, client), TODAY, 4);
    const insights = spendingInsights(txs, { asOf: TODAY, monthCount: 4 });
    expect(
      insights.topMerchants.map((m) => m.merchant).filter((m) => MOVING_MONEY.test(m)),
    ).toEqual([]);
    // Income is the paychecks, the freelance payouts and savings interest, nothing else.
    expect(insights.months.map((m) => m.incomeCents)).toEqual([
      214_055 + 198_710 + 241_000 + 64_000 + 42,
      214_055 + 42,
      260_233 + 195_000 + 214_055 + 112_000 + 42,
      228_840 + 42,
    ]);
    // September: the card's purchases, rent and bills, once each; the cancelled flight's refund
    // and the reversed overdraft fee come off.
    expect(insights.months[2].spendingCents).toBe(387_385);
  });

  it("finds the subscriptions and the price rise, and nothing that isn't one", async () => {
    expect(await isFirstDetectionComplete(userId, { client })).toBe(false);
    await runDetection(userId, { client, now: NOW });
    const findings = await client.finding.findMany({
      where: { userId },
      select: { type: true, title: true, annualSavingsCents: true },
    });
    findings.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
    expect(findings).toEqual([
      // Only the trip's foreign fee: the overdraft fee was given back two days later.
      {
        type: "bank_fees",
        title: "$1.28 in fees on Chase Freedom in the last 4 months",
        annualSavingsCents: 128,
      },
      // $15.49, $15.49, $17.99, $17.99: still a rise after the second charge at the new price.
      {
        type: "price_increase",
        title: "Netflix went up from $15.49 to $17.99",
        annualSavingsCents: 3_000,
      },
      // The $139 "AMAZON PRIME*" charge, seen once: the yearly membership (accuracy bench).
      // Amazon shopping ("AMZN Mktp US") still isn't a subscription.
      expect.objectContaining({
        title: "Review your Amazon Prime subscription",
        annualSavingsCents: 13_900,
      }),
      expect.objectContaining({ title: "Review your Netflix subscription" }),
      expect.objectContaining({ title: "Review your Planet Fitness subscription" }),
      expect.objectContaining({ title: "Review your Spotify subscription" }),
    ]);

    const input = await loadDetectionInput(userId, { client, now: NOW });
    // Coffee three times a week, Amazon orders and weekly groceries aren't subscriptions; the
    // yearly Prime membership is.
    expect(
      recurringCharges(input)
        .filter((r) => r.subscription)
        .map((r) => r.merchant)
        .sort(),
    ).toEqual(["Amazon Prime", "Netflix", "Planet Fitness", "Spotify"]);
    // The monthly move to savings isn't a bill, but the forecast still takes it out of checking.
    const bills = upcomingBills(input, 31).map((b) => b.merchant);
    expect(bills.filter((m) => MOVING_MONEY.test(m))).toEqual([]);
    expect(bills).toContain("Riverside Property Mgmt Rent");
    const [checking] = forecastAccounts(input, 31);
    expect(checking.bills.map((b) => b.merchant).filter((m) => MOVING_MONEY.test(m))).toEqual([]);
    expect(checking.days.find((d) => d.date === "2026-11-05")!.balanceCents).toBeLessThan(
      checking.days.find((d) => d.date === "2026-11-04")!.balanceCents,
    );
  });

  it("suggests nothing the data doesn't show, and is modest about three months", async () => {
    const { suggestions } = await detectFor(userId, { client, now: NOW });
    const topics = suggestions.map((s) => s.topic);
    // No car ("CRD AUTOPAY" isn't a car), no fee habit (one fee was reversed), and one big
    // purchase isn't a month running over.
    expect(topics).not.toContain("auto_insurance");
    expect(topics).not.toContain("bank_fees");
    expect(topics).not.toContain("budget_overrun");
    expect(topics).toContain("subscriptions");
    for (const s of suggestions) {
      expect(s.confidence.percent, s.topic).toBeLessThanOrEqual(
        THIN_DATA_MAX_PERCENT + 3 * THIN_DATA_MAX_PER_MONTH,
      );
    }
  });
});

describe.runIf(url)("a messy real bank, through Plaid", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let itemId: string;
  const suffix = crypto.randomUUID();
  const id = (name: string) => `${suffix}-${name}`;
  const transactionsSync = vi.fn();
  const api = {
    transactionsSync,
    transactionsRecurringGet: vi.fn(async () => {
      throw plaidApiError("PRODUCT_NOT_READY");
    }),
    liabilitiesGet: vi.fn(),
    investmentsHoldingsGet: vi.fn(),
    investmentsTransactionsGet: vi.fn(),
  } as unknown as PlaidApi;
  const accounts = [
    plaidAccount({ account_id: id("chk"), name: "Checking", subtype: "checking" } as never),
    plaidAccount({ account_id: id("sav"), name: "Savings", subtype: "savings" } as never),
    plaidAccount({
      account_id: id("card"),
      name: "Card",
      type: "credit",
      subtype: "credit card",
    } as never),
  ];
  const tx = (
    name: string,
    account: string,
    date: string,
    amount: number,
    description: string,
    detailed: string,
    more: Record<string, unknown> = {},
  ) =>
    plaidTransaction({
      transaction_id: id(name),
      account_id: id(account),
      date,
      amount,
      name: description,
      merchant_name: null,
      iso_currency_code: "USD",
      personal_finance_category: {
        primary: detailed
          .split("_")
          .slice(0, detailed.startsWith("FOOD_AND") ? 3 : 2)
          .join("_"),
        detailed,
        confidence_level: "HIGH",
      },
      ...more,
    } as never);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `messy-plaid-${suffix}@example.com` } }))
      .id;
    itemId = (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `item-${suffix}`,
          accessTokenEncrypted: encrypt("access-sandbox-messy"),
          institutionName: "First Messy Bank",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("counts a pending charge once, at what it posted for, and leaves out a foreign currency", async () => {
    // First sync: two charges still pending, money moved between the person's own accounts,
    // and a row in euros.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts,
        next_cursor: "c1",
        added: [
          tx("pay", "chk", "2026-10-10", -2288.4, "ACME CORP PAYROLL", "INCOME_SALARY"),
          tx(
            "rent",
            "chk",
            "2026-10-01",
            1650,
            "RIVERSIDE PROPERTY MGMT",
            "RENT_AND_UTILITIES_RENT",
          ),
          tx("to-sav", "chk", "2026-10-05", 500, "Online Transfer to SAV", "TRANSFER_OUT_SAVINGS"),
          tx(
            "from-chk",
            "sav",
            "2026-10-05",
            -500,
            "Online Transfer from CHK",
            "TRANSFER_IN_SAVINGS",
          ),
          tx(
            "autopay",
            "chk",
            "2026-10-06",
            812.4,
            "CHASE CREDIT CRD AUTOPAY",
            "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          ),
          tx(
            "thanks",
            "card",
            "2026-10-06",
            -812.4,
            "Payment Thank You",
            "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          ),
          tx("venmo", "chk", "2026-10-09", -120, "VENMO CASHOUT", "TRANSFER_IN_ACCOUNT_TRANSFER"),
          tx("coffee-p", "card", "2026-10-15", 4.75, "SQ *JOES COFFEE", "FOOD_AND_DRINK_COFFEE", {
            pending: true,
          }),
          tx("hotel-p", "card", "2026-10-16", 200, "HOTEL LUTETIA PARIS", "TRAVEL_LODGING", {
            pending: true,
          }),
          tx("eur", "card", "2026-10-16", 35, "CAFE DE FLORE", "FOOD_AND_DRINK_RESTAURANT", {
            iso_currency_code: "EUR",
          }),
        ],
      }),
    );
    await syncItem(itemId, { client, api, now: new Date("2026-10-17T12:00:00Z") });
    // Second sync: the pending charges posted, the coffee with a tip a day later and the
    // hotel's hold for less; Plaid removes the pending rows.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts,
        next_cursor: "c2",
        added: [
          tx("coffee", "card", "2026-10-16", 5.7, "SQ *JOES COFFEE", "FOOD_AND_DRINK_COFFEE", {
            pending_transaction_id: id("coffee-p"),
          }),
          tx("hotel", "card", "2026-10-18", 187.33, "HOTEL LUTETIA PARIS", "TRAVEL_LODGING", {
            pending_transaction_id: id("hotel-p"),
          }),
        ],
        removed: [
          { transaction_id: id("coffee-p"), account_id: id("card") },
          { transaction_id: id("hotel-p"), account_id: id("card") },
        ],
      }),
    );
    await syncItem(itemId, { client, api, now: NOW });

    const rows = await client.transaction.findMany({
      where: { userId },
      select: { plaidTransactionId: true, amountCents: true, pending: true },
    });
    const ids = rows.map((r) => r.plaidTransactionId);
    expect(ids).not.toContain(id("coffee-p"));
    expect(ids).not.toContain(id("hotel-p"));
    expect(ids).not.toContain(id("eur"));
    expect(rows.some((r) => r.pending)).toBe(false);

    const txs = await loadInsightTransactions(scopedFor(userId, client), TODAY, 1);
    const [october] = spendingInsights(txs, { asOf: TODAY, monthCount: 1 }).months;
    // Rent, the coffee at what it posted for and the hotel; no transfer or card payment.
    expect(october).toEqual({
      month: "2026-10",
      spendingCents: 165_000 + 570 + 18_733,
      incomeCents: 228_840,
    });
  });
});
