import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { ACTION_FOR_FINDING } from "@/lib/cards";
import { markAlertsRead, newestUnreadAlerts } from "@/lib/alerts";
import { comparisonFor, comparisonsFor } from "@/lib/compare";
import { savedToDate } from "@/lib/membership/service";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { aheadTiles, loadAheadHub } from "./ahead";
import { loadJaneHub } from "./jane";
import { loadMoneyHub, moneyTiles } from "./money";

// The three hubs (spec step 80) against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts): a person with the demo bank gets the same
// numbers as the full pages, and a person with nothing gets empty states, not errors.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the hubs against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let emptyId: string;
  let otherId: string;
  // Any call to real Plaid fails the test.
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const suffix = crypto.randomUUID();
    const make = async (name: string) =>
      (await client.user.create({ data: { email: `${name}-${suffix}@example.com` } })).id;
    [userId, emptyId, otherId] = await Promise.all([make("hubs"), make("empty"), make("other")]);
    for (const id of [userId, otherId]) {
      const { itemId } = await linkDemoBank(id, { client, now: NOW });
      await syncItem(itemId, { client, api: plaid, now: NOW });
    }
  }, 120_000);

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, emptyId, otherId] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  // A yes on a finding, with its action at the given status.
  async function approve(
    findingType: "bank_fees" | "duplicate_charge" | "card_interest",
    status: "queued" | "waiting_on_user" | "done",
    extra: { userTodo?: string; confirmedAnnualCents?: number } = {},
  ) {
    const finding = await client.finding.findFirstOrThrow({
      where: { userId, type: findingType },
    });
    const decision = await client.decision.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: {
          title: finding.title,
          annualSavingsCents: finding.annualSavingsCents,
          findingType: finding.type,
        },
      },
    });
    await client.finding.update({
      where: { id: finding.id },
      data: { status: status === "done" ? "done" : "approved" },
    });
    await client.action.create({
      data: {
        userId,
        decisionId: decision.id,
        type: ACTION_FOR_FINDING[finding.type],
        status,
        completedAt: status === "done" ? NOW : null,
        ...extra,
      },
    });
    return finding;
  }

  it("Jane: what's to decide, in progress, done and new", async () => {
    const before = await loadJaneHub(userId, { client, now: NOW });
    const open = await client.finding.count({
      where: { userId, status: { in: ["new", "shown"] } },
    });
    expect(before.decide.total).toBe(open);
    expect(before.decide.items).toHaveLength(5);
    expect(before.decide.items[0].title).toBeTruthy();
    // The demo bank's phone or internet bill has a cheaper option compared.
    expect(before.decide.items.some((i) => i.pick?.startsWith("Jane's pick: "))).toBe(true);
    expect(before.inProgress.items).toEqual([]);
    expect(before.done.items).toEqual([]);
    const unread = await client.alert.count({ where: { userId, readAt: null } });
    expect(before.alerts.unread).toBe(unread);
    expect(before.alerts.items.length).toBe(Math.min(3, unread));

    await approve("bank_fees", "queued");
    const card = await approve("card_interest", "waiting_on_user", {
      userTodo: "Send us your card statement.",
    });
    const dup = await approve("duplicate_charge", "done", { confirmedAnnualCents: 6_420 });
    await markAlertsRead(userId, { client, now: NOW });

    const after = await loadJaneHub(userId, { client, now: NOW });
    expect(after.decide.total).toBe(open - 3);
    expect(after.inProgress.total).toBe(2);
    // Waiting on the person first, with what's needed.
    expect(after.inProgress.items[0]).toMatchObject({
      title: card.title,
      label: "Waiting on you",
      todo: "Send us your card statement.",
    });
    expect(after.inProgress.items[1]).toMatchObject({ label: "Queued", todo: null });
    expect(after.done.items).toEqual([
      expect.objectContaining({ title: dup.title, saving: "Saves $64.20 a year, confirmed" }),
    ]);
    expect(after.done.savedToDateCents).toBe(await savedToDate(userId, { client }));
    expect(after.done.savedToDateCents).toBe(6_420);
    expect(after.alerts).toEqual({ unread: 0, items: [] });

    // Only this person's: the other demo user's hub is unchanged.
    const other = await loadJaneHub(otherId, { client, now: NOW });
    expect(other.inProgress.total).toBe(0);
    expect(other.done.savedToDateCents).toBe(0);
  });

  it("Money: the same numbers as the full pages", async () => {
    const data = await loadMoneyHub(userId, { client, now: NOW });
    const accounts = await client.account.findMany({ where: { userId } });
    const debt = (type: string) => type === "credit" || type === "loan";
    const balance = (keep: (type: string) => boolean) =>
      accounts
        .filter((a) => keep(a.type))
        .reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0);
    expect(data.hasAccounts).toBe(true);
    // The demo bank's home and car count at their values (spec step 67).
    const owned = (await client.ownedAsset.findMany({ where: { userId } })).reduce(
      (sum, a) => sum + a.valueCents,
      0,
    );
    expect(data.netWorth.netCents).toBe(balance((t) => !debt(t)) + owned - balance(debt));
    expect(data.netWorth.investmentsCents).toBe(balance((t) => t === "investment"));
    expect(data.hasInvestmentAccounts).toBe(true);
    // The demo bank has its home and car, so nothing to add.
    expect(data.assetPrompt).toBeFalsy();
    expect(data.debt.accounts).toBe(4);
    expect(data.debt.owedCents).toBe(balance(debt));
    expect(data.spendingCents).toBeGreaterThan(0);
    expect(data.recurring.count).toBeGreaterThan(0);
    expect(data.documents).toBe(0);

    const tiles = moneyTiles(data).flatMap((g) => g.tiles);
    expect(tiles.find((t) => t.label === "Things you own")?.status).not.toBe("Add your home");
    expect(tiles.find((t) => t.label === "Investments")?.value).not.toBeNull();
  });

  it("Ahead: yearly bills, deadlines and debt from the demo bank", async () => {
    const data = await loadAheadHub(userId, { client, now: NOW });
    expect(data.asOf).toBe("2026-10-18");
    expect(data.yearly.bills).toBeGreaterThan(0);
    expect(data.yearly.monthlyCents).toBeGreaterThan(0);
    expect(data.deadlines.next).not.toBeNull();
    expect(data.deadlines.next!.date >= "2026-10-18").toBe(true);
    expect(data.deadlines.soon).toBeGreaterThan(0);
    // Cards and loans, without the mortgage, as on the debt planner.
    const debts = await client.account.findMany({
      where: {
        userId,
        OR: [{ type: "credit" }, { type: "loan", NOT: { subtype: "mortgage" } }],
      },
    });
    expect(data.debt.accounts).toBe(debts.length);
    expect(data.debt.owedCents).toBe(
      debts.reduce((sum, a) => sum + Math.max(0, a.currentBalanceCents ?? 0), 0),
    );
    expect(data.lifeEvents).toEqual({ open: 0, newest: null });

    await client.lifeEvent.create({
      data: {
        userId,
        kind: "moving",
        startedOn: NOW,
        checkedItems: ["bank-address", "internet", "not-a-real-item"],
      },
    });
    const withEvent = await loadAheadHub(userId, { client, now: NOW });
    expect(withEvent.lifeEvents.open).toBe(1);
    expect(withEvent.lifeEvents.newest).toMatchObject({ title: "Moving", done: 2 });
  });

  it("compares several findings at once, the same as one at a time", async () => {
    const findings = await client.finding.findMany({
      where: { userId: otherId },
      select: { id: true, type: true, evidence: true },
      orderBy: { id: "asc" },
    });
    const together = await comparisonsFor(findings, { userId: otherId, client, now: NOW });
    const oneByOne = await Promise.all(
      findings.map((f) => comparisonFor(f, { userId: otherId, client, now: NOW })),
    );
    expect(together).toEqual(oneByOne);
    expect(together.filter(Boolean).length).toBeGreaterThan(0);
    expect(await comparisonsFor([], { userId: otherId, client })).toEqual([]);
  });

  it("lists the newest unread alerts without marking them read, minus turned-off types", async () => {
    const id = (
      await client.user.create({
        data: {
          email: `alerts-${crypto.randomUUID()}@example.com`,
          alertPrefs: { fee_charged: "off" },
        },
      })
    ).id;
    const at = (minute: number) => new Date(NOW.getTime() + minute * 60_000);
    await client.alert.createMany({
      data: [
        { userId: id, type: "large_charge", key: "a", title: "Oldest", body: "", createdAt: at(1) },
        { userId: id, type: "large_charge", key: "b", title: "Newer", body: "", createdAt: at(2) },
        { userId: id, type: "low_balance", key: "c", title: "Newest", body: "", createdAt: at(3) },
        {
          userId: id,
          type: "fee_charged",
          key: "d",
          title: "Turned off",
          body: "",
          createdAt: at(4),
        },
        {
          userId: id,
          type: "large_charge",
          key: "e",
          title: "Read",
          body: "",
          createdAt: at(5),
          readAt: at(6),
        },
      ],
    });
    const alerts = await newestUnreadAlerts(id, { client, limit: 2 });
    expect(alerts.map((a) => a.title)).toEqual(["Newest", "Newer"]);
    expect(await client.alert.count({ where: { userId: id, readAt: null } })).toBe(4);
    // Someone else's alerts never show.
    expect(await newestUnreadAlerts(emptyId, { client, limit: 5 })).toEqual([]);
    await client.user.delete({ where: { id } });
  });

  it("someone with nothing linked gets empty states, not errors", async () => {
    const jane = await loadJaneHub(emptyId, { client, now: NOW });
    expect(jane.decide).toEqual({ total: 0, totalSavingsCents: 0, items: [] });
    expect(jane.inProgress).toEqual({ total: 0, items: [] });
    expect(jane.done).toEqual({ total: 0, savedToDateCents: 0, items: [] });
    expect(jane.alerts).toEqual({ unread: 0, items: [] });

    const money = await loadMoneyHub(emptyId, { client, now: NOW });
    expect(money).toMatchObject({
      hasAccounts: false,
      hasInvestmentAccounts: false,
      spendingCents: 0,
      recurring: { count: 0, yearlyCents: 0 },
      debt: { accounts: 0, owedCents: 0 },
      documents: 0,
      insurance: { policies: 0, gaps: 0 },
    });
    expect(moneyTiles(money).flatMap((g) => g.tiles.map((t) => t.label))).not.toContain(
      "Investments",
    );

    const ahead = await loadAheadHub(emptyId, { client, now: NOW });
    expect(ahead).toMatchObject({
      yearly: { monthlyCents: 0, bills: 0 },
      deadlines: { next: null, soon: 0 },
      debt: { accounts: 0, owedCents: 0 },
      lifeEvents: { open: 0, newest: null },
    });
    expect(aheadTiles(ahead).flatMap((g) => g.tiles)).toHaveLength(9);
  });
});
