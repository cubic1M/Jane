import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { markDiyDone } from "@/lib/decisions";
import { savedItems } from "@/lib/membership/service";
import {
  markSuggestionDone,
  recordAnswer,
  recordOpened,
  recordShown,
  savingsRecord,
  verifyOutcomes,
} from "./outcomes";
import { verifiedSavings } from "./savings-proof";

// The verified savings record against a real, migrated Postgres: a suggestion that reached the
// person is kept from its showing to its answer, and what they acted on counts as confirmed only
// once their own transactions show it, with those transactions as evidence. Everything else
// stays expected, apart.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T15:00:00Z`);
const HULU = {
  kind: "charge_stops" as const,
  payees: [{ description: "HULU 877-8244858", amountCents: 1_799, perYear: 12 }],
};

describe.runIf(url)("the verified savings record", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person() {
    const user = await client.user.create({
      data: { email: `outcomes-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const charge = (date: string, description: string, amountCents: number, pfc?: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          date: new Date(`${date}T00:00:00Z`),
          description,
          amountCents,
          pfcPrimary: "ENTERTAINMENT",
          pfcDetailed: pfc ?? "ENTERTAINMENT_TV_AND_MOVIES",
        },
        select: { id: true },
      });
    return { userId: user.id, charge };
  }

  const shown = (key: string, watch: unknown = HULU) => ({
    key,
    capability: "subscriptions",
    topic: "subscriptions",
    title: "Cancel subscriptions you don't use",
    worthCents: 21_588,
    worthKind: "saves",
    confidencePercent: 80,
    watch: watch as never,
  });

  it("keeps shown, opened and answered, and confirms from the transactions", async () => {
    const { userId, charge } = await person();
    await charge("2026-06-03", "HULU 877-8244858", 1_799);
    await charge("2026-07-03", "HULU 877-8244858", 1_799);
    const last = await charge("2026-08-03", "HULU 877-8244858", 1_799);

    await recordShown(userId, [shown("subscriptions:subscriptions")], {
      client,
      now: at("2026-08-09"),
    });
    await recordShown(userId, [shown("subscriptions:subscriptions")], {
      client,
      now: at("2026-08-10"),
    });
    await recordOpened(userId, "subscriptions:subscriptions", { client, now: at("2026-08-10") });
    await recordAnswer(userId, "subscriptions:subscriptions", "yes", {
      client,
      now: at("2026-08-10"),
    });
    let row = await client.suggestionOutcome.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({ timesShown: 2, status: "open", answer: "yes" });
    expect(row.openedAt).not.toBeNull();

    // Before the next charge was due: still waiting, expected not confirmed.
    expect(await verifyOutcomes(userId, { client, now: at("2026-09-05") })).toMatchObject({
      checked: 1,
      confirmed: 0,
    });
    expect((await savingsRecord(userId, { client })).expected).toHaveLength(1);

    // Past the due day, but no statement after it yet: nothing verified (an absence needs one).
    expect(await verifyOutcomes(userId, { client, now: at("2026-09-20") })).toMatchObject({
      confirmed: 0,
    });
    // A newer statement reaches past the due day: the next one never came. Confirmed, a year of
    // it, with the last charge as evidence.
    await charge("2026-09-18", "TRADER JOE'S #552", 4_210, "FOOD_AND_DRINK_GROCERIES");
    expect(await verifyOutcomes(userId, { client, now: at("2026-09-20") })).toMatchObject({
      confirmed: 1,
    });
    row = await client.suggestionOutcome.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({
      status: "confirmed",
      confirmedCents: 21_588,
      yearly: true,
      verifiedPercent: 85,
      evidenceTxIds: [last.id],
    });
    const record = await savingsRecord(userId, { client });
    expect(record.confirmedCents).toBe(21_588);
    expect(record.confirmed[0].evidence).toEqual([
      { id: last.id, date: "2026-08-03", description: "HULU 877-8244858", amountCents: 1_799 },
    ]);
    expect(record.expected).toEqual([]);

    // The whole record: confirmed apart from expected, and on the home tile's items.
    const all = await verifiedSavings(userId, { client, now: at("2026-09-20") });
    expect(all.confirmedCents).toBe(21_588);
    expect(await savedItems(userId, { client })).toEqual([
      {
        title: "Cancel subscriptions you don't use",
        kind: "done_yourself",
        cents: 21_588,
        yearly: true,
      },
    ]);
  });

  it("confirms an investing saving from what they hold: a costly fund gone, with the proof", async () => {
    const { userId } = await person();
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Fidelity",
        type: "investment",
        subtype: "brokerage",
        currentBalanceCents: 5_000_000,
      },
    });
    const security = await client.security.create({
      data: {
        userId,
        plaidSecurityId: `csv:FCNTX-${userId}`,
        name: "Contrafund",
        ticker: "FCNTX",
        type: "mutual fund",
      },
    });
    const holding = await client.holding.create({
      data: {
        userId,
        accountId: account.id,
        securityId: security.id,
        quantity: 100,
        priceCents: 50_000,
        valueCents: 5_000_000,
      },
    });
    const watch = {
      kind: "funds_left",
      funds: [{ ticker: "FCNTX", valueCents: 5_000_000, yearlyCents: 19_000 }],
    };
    const fees = {
      key: "investing:investment_fees",
      capability: "investing",
      topic: "investment_fees",
      title: "Switch to cheaper funds",
      worthCents: 19_000,
      worthKind: "saves",
      confidencePercent: 80,
      watch: watch as never,
    };
    await recordShown(userId, [fees], { client, now: at("2026-10-01") });
    await recordAnswer(userId, "investing:investment_fees", "yes", {
      client,
      now: at("2026-10-01"),
    });
    // Still held: waiting, an expectation.
    expect(await verifyOutcomes(userId, { client, now: at("2026-10-10") })).toMatchObject({
      confirmed: 0,
    });
    // Sold: the next holdings show it gone.
    await client.holding.update({
      where: { id: holding.id },
      data: { valueCents: 0, quantity: 0 },
    });
    expect(await verifyOutcomes(userId, { client, now: at("2026-10-20") })).toMatchObject({
      confirmed: 1,
    });
    const row = await client.suggestionOutcome.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({
      status: "confirmed",
      confirmedCents: 19_000,
      yearly: true,
      verifiedPercent: 90,
    });
    expect(row.proof).toMatch(/FCNTX went from \$50,000\.00 to \$0\.00/);
    const record = await savingsRecord(userId, { client });
    expect(record.confirmedCents).toBe(19_000);
  });

  it("keeps a no apart, and a yes with nothing to watch as an expectation", async () => {
    const { userId } = await person();
    await recordShown(userId, [shown("a:no"), shown("b:unseen", null)], {
      client,
      now: at("2026-08-10"),
    });
    await recordAnswer(userId, "a:no", "no", { client, now: at("2026-08-10") });
    await recordAnswer(userId, "b:unseen", "yes", { client, now: at("2026-08-10") });
    const rows = await client.suggestionOutcome.findMany({
      where: { userId },
      orderBy: { suggestionKey: "asc" },
    });
    expect(rows.map((r) => r.status)).toEqual(["declined", "unverifiable"]);
    const record = await savingsRecord(userId, { client });
    expect(record.expected.map((o) => o.key)).toEqual(["b:unseen"]);
    expect(record.confirmed).toEqual([]);
  });

  it("marks a suggestion done (the read-only Mark done), and says when it isn't seen", async () => {
    const { userId, charge } = await person();
    await client.suggestion.create({
      data: {
        userId,
        key: "subscriptions:trial_conversion",
        capability: "subscriptions",
        topic: "trial_conversion",
        title: "Cancel a trial now billing you",
        worthCents: 21_588,
        worthKind: "saves",
        confidencePercent: 80,
        confidenceReason: "charges after a trial",
        urgency: "soon",
        why: "x",
        actionLabel: "Review subscriptions",
        actionHref: "/subscriptions",
        watch: HULU,
      },
    });
    await charge("2026-08-03", "HULU 877-8244858", 1_799);
    expect(
      await markSuggestionDone(userId, "subscriptions:trial_conversion", {
        client,
        now: at("2026-08-10"),
      }),
    ).toEqual({ status: "open" });
    expect((await client.suggestion.findFirstOrThrow({ where: { userId } })).status).toBe("yes");
    const again = await charge("2026-09-03", "HULU 877-8244858", 1_799);
    await verifyOutcomes(userId, { client, now: at("2026-09-10") });
    const row = await client.suggestionOutcome.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({ status: "not_seen", evidenceTxIds: [again.id] });
    expect((await savingsRecord(userId, { client })).notSeen).toHaveLength(1);
    await expect(
      markSuggestionDone(userId, "nothing:here", { client, now: at("2026-09-10") }),
    ).rejects.toThrow(/isn't there/);
  });

  it("watches a do-it-yourself finding card once it's marked done", async () => {
    const { userId, charge } = await person();
    const last = await charge("2026-08-03", "NETFLIX.COM", 1_549);
    const finding = await client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key: "netflix",
        title: "Review your Netflix subscription",
        annualSavingsCents: 18_588,
        amountCents: 1_549,
        confidence: "high",
        evidence: {
          merchant: "Netflix",
          frequency: "MONTHLY",
          lastAmountCents: 1_549,
          annualCostCents: 18_588,
          charges: [
            { id: last.id, date: "2026-08-03", amountCents: 1_549, description: "NETFLIX.COM" },
          ],
        },
      },
    });
    const decision = await client.decision.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "diy",
        cardSnapshot: { title: finding.title, annualSavingsCents: 18_588 },
      },
    });
    const decisionId = decision.id;
    await markDiyDone(userId, decisionId, { client, now: at("2026-08-10") });
    await charge("2026-09-18", "TRADER JOE'S #552", 4_210, "FOOD_AND_DRINK_GROCERIES");
    await verifyOutcomes(userId, { client, now: at("2026-09-20") });
    const record = await savingsRecord(userId, { client });
    expect(record.confirmed.map((o) => [o.key, o.confirmedCents])).toEqual([
      [`finding:${finding.id}`, 18_588],
    ]);
    // Counted once on the home tile: as the do-it-yourself card it already was.
    expect((await savedItems(userId, { client })).length).toBe(1);
  });
});
