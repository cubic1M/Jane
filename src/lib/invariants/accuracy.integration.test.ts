import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { PRODUCTION_NOW, productionBank } from "@/data-sources/plaid/__fixtures__/production";
import { encrypt } from "@/lib/crypto";
import { syncItem } from "@/lib/plaid/sync";
import { ACCURACY_JOB, runAccuracyChecks, type AccuracySummary } from "./accuracy";
import { sendAccuracyEmail } from "./accuracy-email";

// The daily accuracy checks on a real person's Plaid production data (hand-built fixtures), with a
// demo-bank person and a trial person beside them who must not count. Then each kind of wrong data
// the checks exist for, put in by hand: each must fail its own check, by name and count only.
const url = process.env.TEST_DATABASE_URL;
const NOW = PRODUCTION_NOW;

describe.runIf(url)("the daily accuracy checks", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  let real: string;
  let demo: string;
  let trial: string;
  let bank: ReturnType<typeof productionBank>;

  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  const failed = (summary: AccuracySummary) =>
    Object.fromEntries(summary.checks.map((c) => [c.name, c.failed]));
  const run = () => runAccuracyChecks({ client, now: NOW, userIds: [real, demo, trial] });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ADMIN_EMAILS", "team@jane.test");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });

    real = (await client.user.create({ data: { email: `acc-${crypto.randomUUID()}@example.com` } }))
      .id;
    trial = (
      await client.user.create({
        data: {
          id: `trial_${crypto.randomUUID()}`,
          email: `acc-${crypto.randomUUID()}@example.com`,
        },
      })
    ).id;
    demo = (await client.user.create({ data: { email: `acc-${crypto.randomUUID()}@example.com` } }))
      .id;
    created.push(real, trial, demo);

    bank = productionBank(`a${crypto.randomUUID().slice(0, 8)}`);
    const itemId = (
      await client.plaidItem.create({
        data: {
          userId: real,
          plaidItemId: `item-${crypto.randomUUID()}`,
          accessTokenEncrypted: encrypt("access-production-accuracy"),
          institutionName: "Chase",
          liabilities: true,
        },
      })
    ).id;
    const pages = bank.syncs.flat();
    let next = 0;
    const api = {
      transactionsSync: vi.fn(async () => pages[next++]),
      transactionsRecurringGet: vi.fn(async () => ({ data: bank.recurring })),
      liabilitiesGet: vi.fn(async () => ({ data: bank.liabilities })),
    } as unknown as PlaidApi;
    for (let i = 0; i < bank.syncs.length; i += 1)
      await syncItem(itemId, { client, api, now: NOW });

    // Daily balances that agree with the transactions between them, worked out by hand. Checking:
    // the Oct 22 card payment out ($405.55) and the Nov 1 pay in ($1,250): up $844.45 to $2,150.
    // The card: November's dinner, gas and coffee ($105.06) up to $431.63.
    const accounts = new Map(
      (
        await client.account.findMany({
          where: { userId: real },
          select: { id: true, plaidAccountId: true },
        })
      ).map((a) => [a.plaidAccountId, a.id]),
    );
    const checking = accounts.get(bank.accounts.checking.account_id)!;
    const card = accounts.get(bank.accounts.card.account_id)!;
    await client.balanceSnapshot.createMany({
      data: [
        { userId: real, accountId: checking, date: day("2026-10-20"), balanceCents: 130555 },
        { userId: real, accountId: checking, date: day("2026-11-04"), balanceCents: 215000 },
        { userId: real, accountId: card, date: day("2026-10-24"), balanceCents: 32657 },
        { userId: real, accountId: card, date: day("2026-11-04"), balanceCents: 43163 },
      ],
    });

    // Only the demo bank: sample data, not checked.
    const demoItem = await client.plaidItem.create({
      data: {
        userId: demo,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt("access-demo-accuracy"),
        institutionName: "Demo bank",
      },
    });
    await client.account.create({
      data: {
        userId: demo,
        itemId: demoItem.id,
        source: "plaid",
        plaidAccountId: `demo-acct-${crypto.randomUUID()}`,
        name: "Demo checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 100,
      },
    });
    // A trial person with an upload: sample data too.
    await client.account.create({
      data: {
        userId: trial,
        source: "csv",
        name: "Trial checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 100,
      },
    });
  }, 240_000);

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("passes every check on right figures, for real people only, and says nothing but counts", async () => {
    const summary = await run();
    expect(summary).toMatchObject({
      people: 1,
      checked: 1,
      notChecked: 0,
      errored: 0,
      failing: [],
    });
    const counts = Object.fromEntries(summary.checks.map((c) => [c.name, c]));
    expect(counts.balance_matches_history).toEqual(
      expect.objectContaining({ name: "balance_matches_history", passed: 2, failed: 0 }),
    );
    expect(counts.suggestion_figures_trace.passed).toBe(2);
    expect(counts.recurring_two_occurrences.passed).toBe(1);
    // The 44 rows less the four before the 90 days (Aug 7 on): Aug 1's pay, Aug 2's rent and both
    // sides of Aug 5's transfer to savings.
    expect(counts.no_duplicate_transactions).toMatchObject({ passed: 40, failed: 0 });
    expect(counts.no_future_transactions).toMatchObject({ passed: 40, failed: 0 });
    expect(counts.areas_add_up_to_home.failed).toBe(0);
    expect(counts.areas_add_up_to_home.passed).toBeGreaterThanOrEqual(4);
    // Names, ids, emails, merchants and amounts never leave.
    const said = JSON.stringify(summary);
    for (const secret of [
      real,
      demo,
      trial,
      "Spotify",
      "Safeway",
      "Acme",
      "example.com",
      "1199",
      "215000",
    ])
      expect(said).not.toContain(secret);
  });

  it("counts whoever the run's time didn't reach, never checking past it", async () => {
    let tick = 0;
    const summary = await runAccuracyChecks({
      client,
      now: NOW,
      userIds: [real],
      budgetMs: 10,
      clock: () => (tick += 100),
    });
    expect(summary).toMatchObject({ people: 1, checked: 0, notChecked: 1, failing: [] });
  });

  it("fails each check on the wrong data it exists for", async () => {
    const accounts = await client.account.findMany({
      where: { userId: real },
      select: { id: true, plaidAccountId: true },
    });
    const id = (plaid: string) => accounts.find((a) => a.plaidAccountId === plaid)!.id;
    const checking = id(bank.accounts.checking.account_id);
    const card = id(bank.accounts.card.account_id);
    const row = (over: { accountId: string; date: Date } & Record<string, unknown>) => ({
      userId: real,
      source: "plaid" as const,
      plaidTransactionId: `broken-${crypto.randomUUID()}`,
      description: "SOMETHING",
      amountCents: 1000,
      pending: false,
      ...over,
    });
    await client.transaction.createMany({
      data: [
        // In the future, a pending charge never taken away, and a second copy of August's groceries.
        row({ accountId: checking, date: day("2026-11-09") }),
        row({ accountId: checking, date: day("2026-10-10"), pending: true }),
        row({
          accountId: card,
          date: day("2026-08-09"),
          description: "SAFEWAY STORE",
          amountCents: 8740,
        }),
      ],
    });
    // A balance that moved with nothing behind it.
    await client.balanceSnapshot.create({
      data: { userId: real, accountId: checking, date: day("2026-11-03"), balanceCents: 1 },
    });
    // A Spotify charge the bank changed after Jane read it.
    await client.transaction.updateMany({
      where: { plaidTransactionId: bank.ids("spotify-10") },
      data: { amountCents: 1299 },
    });
    // Something recurring said from one charge.
    const [one] = await client.transaction.findMany({
      where: { plaidTransactionId: bank.ids("dinner-11") },
      select: { id: true, date: true, amountCents: true, description: true },
    });
    await client.finding.create({
      data: {
        userId: real,
        type: "subscription_review",
        key: "merchant:the local cafe",
        title: "Review your The Local Cafe subscription",
        confidence: "low",
        annualSavingsCents: 57600,
        amountCents: 57600,
        evidence: {
          frequency: "MONTHLY",
          charges: [{ ...one, date: one.date.toISOString().slice(0, 10) }],
        },
      },
    });

    expect(failed(await run())).toEqual({
      balance_matches_history: 1,
      // The Spotify finding, now off its charge.
      suggestion_figures_trace: 1,
      recurring_two_occurrences: 1,
      no_duplicate_transactions: 1,
      no_stale_pending: 1,
      no_future_transactions: 1,
      areas_add_up_to_home: 0,
    });
  });

  it("emails the team the failing checks by name and count, once a day", async () => {
    await client.cronRun.create({
      data: {
        name: ACCURACY_JOB,
        startedAt: NOW,
        finishedAt: NOW,
        ok: true,
        summary: (await run()) as never,
      },
    });
    const send = vi.fn(async () => undefined);
    const later = new Date(NOW.getTime() + 60_000);
    expect(await sendAccuracyEmail({ client, now: later, send })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [message] = send.mock.calls[0] as unknown as [{ subject: string; text: string }];
    expect(message.subject).toBe("Jane accuracy: 6 checks failing");
    expect(message.text).toContain("no_future_transactions: 1 of ");
    expect(message.text).toContain("/admin/accuracy");
    for (const secret of [real, "Spotify", "Safeway", "Local Cafe", "$"])
      expect(message.text).not.toContain(secret);
    // The same day again: nothing more.
    expect(await sendAccuracyEmail({ client, now: later, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    await client.healthNotice.deleteMany({
      where: { key: `accuracy:${later.toISOString().slice(0, 10)}` },
    });
    await client.cronRun.deleteMany({ where: { name: ACCURACY_JOB, startedAt: NOW } });
  });
});
