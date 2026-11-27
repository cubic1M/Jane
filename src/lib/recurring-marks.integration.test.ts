import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadDetectionInput } from "@/detection/input";
import { recurringCharges } from "@/detection/subscriptions";
import { spendingLines } from "@/insights/spending";
import { loadInsightTransactions } from "@/insights/load";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { scopedFor } from "@/lib/db-scoped";
import { chargeAnchor, loadRecurringCharges, recurringMarks } from "./recurring-marks";

// "Note out the recurring payments, so they are easy to spot" (founder, 11-26): a spending row
// is marked when it belongs to a charge the Subscriptions page lists, with that page's split
// into subscriptions and other regular bills, and never otherwise.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T18:00:00Z");

describe.runIf(url)("recurring marks on spending rows", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  const ids = new Map<string, string>();

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: `recurring-marks-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    userId = user.id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 500_000,
      },
    });
    let n = 0;
    const row = async (
      date: string,
      amountCents: number,
      name: string,
      pfcPrimary: string,
      pfcDetailed: string,
    ) => {
      const t = await client.transaction.create({
        data: {
          userId,
          accountId: account.id,
          source: "csv",
          dedupeKey: String(n++),
          date: new Date(`${date}T12:00:00Z`),
          amountCents,
          description: name,
          merchantName: name,
          pfcPrimary,
          pfcDetailed,
          categorySource: "rule",
        },
      });
      ids.set(`${name} ${date}`, t.id);
    };
    for (const d of ["2026-08-14", "2026-09-14", "2026-10-14", "2026-11-14"]) {
      await row(d, 1_549, "Netflix", "ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES");
    }
    for (const d of ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"]) {
      await row(
        d,
        240_000,
        "Essex Property Trust",
        "RENT_AND_UTILITIES",
        "RENT_AND_UTILITIES_RENT",
      );
    }
    await row("2026-11-02", 650, "Blue Bottle Coffee", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE");
    await row("2026-10-20", 4_210, "Trader Joes", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES");
    await row("2026-09-05", 8_900, "Home Depot", "HOME_IMPROVEMENT", "HOME_IMPROVEMENT_HARDWARE");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const idOf = (name: string, date: string) => ids.get(`${name} ${date}`)!;

  it("lists Netflix as a subscription and the rent as another regular bill", async () => {
    const charges = await loadRecurringCharges(userId, { client, now: NOW });
    expect(charges.map((c) => [c.merchant, c.subscription])).toEqual(
      expect.arrayContaining([
        ["Netflix", true],
        ["Essex Property Trust", false],
      ]),
    );
    expect(charges.some((c) => /coffee|trader|depot/i.test(c.merchant))).toBe(false);
  });

  it("marks the same rows on Transactions, the month view and Money", async () => {
    const charges = await loadRecurringCharges(userId, { client, now: NOW });
    const marks = recurringMarks(charges);
    const db = scopedFor(userId, client);

    // Transactions: every row, as the page reads it.
    const rows = await db.transactions.findMany({
      select: { id: true, accountId: true, merchantName: true, description: true },
    });
    const label = (id: string) => {
      const r = rows.find((x) => x.id === id)!;
      return marks.forTransaction(r)?.label ?? null;
    };
    for (const d of ["2026-08-14", "2026-09-14", "2026-10-14", "2026-11-14"])
      expect(label(idOf("Netflix", d))).toBe("Subscription · monthly");
    for (const d of ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"])
      expect(label(idOf("Essex Property Trust", d))).toBe("Repeats monthly");
    for (const [n, d] of [
      ["Blue Bottle Coffee", "2026-11-02"],
      ["Trader Joes", "2026-10-20"],
      ["Home Depot", "2026-09-05"],
    ] as const)
      expect(label(idOf(n, d))).toBeNull();

    // The month view's lines.
    const transactions = await loadInsightTransactions(db, "2026-11-17", 6);
    const lines = spendingLines(transactions, {
      asOf: "2026-11-17",
      monthCount: 6,
      repeatOf: (t) => marks.forTransaction(t),
    });
    const byMerchant = (m: string) => lines.filter((l) => l.merchant === m);
    expect(byMerchant("Netflix").map((l) => l.repeat?.label)).toEqual(
      Array(4).fill("Subscription · monthly"),
    );
    expect(
      byMerchant("Essex Property Trust").every((l) => l.repeat?.label === "Repeats monthly"),
    ).toBe(true);
    expect(byMerchant("Blue Bottle Coffee")[0]!.repeat).toBeNull();

    // Money's merchants.
    const money = await loadMoneyArea(userId, { client, now: NOW });
    const top = Object.fromEntries(money!.topMerchants.map((m) => [m.merchant, m.repeat?.label]));
    expect(top["Essex Property Trust"]).toBe("Repeats monthly");
    expect(top["Netflix"]).toBe("Subscription · monthly");
    expect(top["Blue Bottle Coffee"] ?? null).toBeNull();
  });

  it("agrees with the Subscriptions page for the same person", async () => {
    // The page's own read: the detection input and the merchants they have answered about.
    const db = scopedFor(userId, client);
    const input = await loadDetectionInput(userId, { client, now: NOW });
    const checks = await db.subscriptionChecks.findMany({
      select: { merchantKey: true, isSubscription: true },
    });
    input.subscriptionMerchantKeys = checks
      .filter((c) => c.isSubscription)
      .map((c) => c.merchantKey);
    input.declinedSubscriptionMerchantKeys = checks
      .filter((c) => !c.isSubscription)
      .map((c) => c.merchantKey);
    const page = recurringCharges(input);

    const marks = recurringMarks(await loadRecurringCharges(userId, { client, now: NOW }));
    const all = await db.transactions.findMany({
      select: { id: true, accountId: true, merchantName: true, description: true },
    });
    const marked = new Set(all.filter((t) => marks.forTransaction(t)).map((t) => t.id));
    // A row is marked exactly when a charge listed on the page is made of it.
    expect(marked).toEqual(new Set(page.flatMap((c) => c.transactionIds)));
    for (const c of page)
      for (const id of c.transactionIds) {
        const t = all.find((x) => x.id === id)!;
        expect(marks.forTransaction(t)?.kind).toBe(c.subscription ? "subscription" : "bill");
        expect(marks.forTransaction(t)?.href).toContain(encodeURIComponent(chargeAnchor(c.key)));
      }

    // Money's recurring list is the same split.
    const money = await loadMoneyArea(userId, { client, now: NOW });
    expect(money!.recurring.map((r) => [r.key, r.subscription]).sort()).toEqual(
      page.map((c) => [c.key, c.subscription]).sort(),
    );
  });
});
