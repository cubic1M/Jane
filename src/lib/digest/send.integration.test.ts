import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type FindingType, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { ACTION_FOR_FINDING } from "@/lib/cards";
import { savedToDate } from "@/lib/membership/service";
import { findingOfType } from "../__fixtures__/findings";
import { runDigests } from "./send";
import { digestNumbers } from "./stats";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
// Other tests share the database, so assertions look only at this file's users.
const url = process.env.TEST_DATABASE_URL;
// A Monday afternoon in California.
const MONDAY = new Date("2026-10-19T22:00:00Z");

describe.runIf(url)("runDigests against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  const ids: Record<string, string> = {};
  const send = vi.fn();

  async function person(
    name: string,
    opts: { account?: boolean; finding?: boolean; digest?: boolean } = {},
  ) {
    const user = await client.user.create({
      data: { email: `${name}-${suffix}@example.com`, digestEnabled: opts.digest ?? true },
    });
    ids[name] = user.id;
    if (opts.account ?? true) {
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Card",
          type: "credit",
          subtype: "credit card",
        },
      });
    }
    if (opts.finding) {
      const f = findingOfType("bank_fees");
      await client.finding.create({
        data: {
          userId: user.id,
          type: f.type,
          key: f.key,
          title: f.title,
          annualSavingsCents: f.annualSavingsCents,
          amountCents: f.amountCents,
          confidence: f.confidence,
          evidence: f.evidence as Prisma.InputJsonObject,
          createdAt: new Date("2026-10-17T00:00:00Z"),
        },
      });
    }
  }

  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("APP_URL", "https://app.example.com");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await person("news", { finding: true });
    await person("quiet");
    await person("optedout", { finding: true, digest: false });
    await person("unlinked", { account: false });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    send.mockReset();
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
  });

  // A run kept to this file's own people: everyone else in the shared database is another file's.
  const own = () => Object.values(ids);
  const digestsOf = (name: string) => client.digest.findMany({ where: { userId: ids[name] } });
  const sentTo = () => send.mock.calls.map(([mail]) => mail.to as string);

  it("dry run renders digests for everyone due without sending or storing", async () => {
    const run = await runDigests({ client, userIds: own(), now: MONDAY, dryRun: true, send });

    const preview = run.previews.find((p) => p.userId === ids.news);
    expect(preview?.text).toContain("New since last week");
    expect(run.previews.some((p) => p.userId === ids.quiet)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(await digestsOf("news")).toEqual([]);
  });

  it("sends once per week, only to active people with something to say", async () => {
    await runDigests({ client, userIds: own(), now: MONDAY, send });

    expect(sentTo().filter((to) => to.includes(suffix))).toEqual([`news-${suffix}@example.com`]);
    const mail = send.mock.calls.find(([m]) => m.to.includes("news-"))?.[0];
    expect(mail.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/app\.example\.com\/api\/unsubscribe\?token=/,
    );
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.html).toContain("https://app.example.com/api/digest/click?d=");
    const [digest] = await digestsOf("news");
    expect(digest.sentAt).toEqual(MONDAY);
    expect(digest.weekStart.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(track).toHaveBeenCalledWith(ids.news, "digest_sent", expect.any(Object));

    send.mockReset();
    await runDigests({ client, userIds: own(), now: new Date("2026-10-20T22:00:00Z"), send });
    expect(sentTo().filter((to) => to.includes(suffix))).toEqual([]);
  });

  it("keeps nothing when sending fails, so the next run retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const nextMonday = new Date("2026-10-26T22:00:00Z");
    await client.finding.updateMany({
      where: { userId: ids.news },
      data: { createdAt: new Date("2026-10-24T00:00:00Z") },
    });
    send.mockRejectedValue(new Error("Resend down"));

    await runDigests({ client, userIds: own(), now: nextMonday, send });

    expect((await digestsOf("news")).map((d) => d.weekStart.toISOString().slice(0, 10))).toEqual([
      "2026-10-19",
    ]);
  });

  it("lists alerts that weren't emailed, unless the person turned that type off", async () => {
    const alert = { type: "fee_charged" as const, title: "$35.00 fee on Checking", body: "b" };
    for (const [name, alertPrefs] of [
      ["alerted", {}],
      ["muted", { fee_charged: "off" }],
    ] as const) {
      await person(name);
      await client.user.update({ where: { id: ids[name] }, data: { alertPrefs } });
      await client.alert.create({
        data: { userId: ids[name], ...alert, key: "tx_1", createdAt: new Date("2026-10-17") },
      });
    }

    const run = await runDigests({ client, userIds: own(), now: MONDAY, dryRun: true, send });

    const preview = run.previews.find((p) => p.userId === ids.alerted);
    expect(preview?.text).toContain("What changed\n- $35.00 fee on Checking");
    expect(run.previews.some((p) => p.userId === ids.muted)).toBe(false);
  });

  it("adds budgets, goals and net worth for people who use them, matching the pages", async () => {
    await person("planner");
    const userId = ids.planner;
    const account = await client.account.findFirstOrThrow({ where: { userId } });
    await client.account.update({
      where: { id: account.id },
      data: { currentBalanceCents: 30_000 },
    });
    // Card balance a week ago was $250 owed; now $300: net worth down $50.
    await client.balanceSnapshot.create({
      data: { userId, accountId: account.id, date: new Date("2026-10-12"), balanceCents: 25_000 },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "csv",
        dedupeKey: "food-1",
        date: new Date("2026-10-05"),
        amountCents: 23_000,
        description: "GROCER",
        pfcPrimary: "FOOD_AND_DRINK",
      },
    });
    await client.budget.create({
      data: { userId, category: "Food and drink", amountCents: 20_000 },
    });
    await client.savingsGoal.create({
      data: {
        userId,
        name: "Trip",
        targetCents: 100_000,
        targetDate: new Date("2027-06-01"),
        manualSavedCents: 40_000,
      },
    });

    const run = await runDigests({ client, userIds: own(), now: MONDAY, dryRun: true, send });
    const preview = run.previews.find((p) => p.userId === userId);

    expect(preview?.text).toContain(
      "Budgets this month\n- Food and drink: $230.00 of $200.00 (over)",
    );
    expect(preview?.text).toContain("Your goals\n- Trip: 40%");
    expect(preview?.text).toContain("Net worth\n- -$300.00, down $50.00 this week");
  });

  // docs/feature-audit.md, cluster 9: the email's "Saved so far" is /jane's and Home's total,
  // so a saving that never showed up in the transactions (spec step 207) doesn't count.
  it("says the same saved-so-far as /jane, without savings that never showed up", async () => {
    await person("saver", { finding: true });
    const userId = ids.saver;
    const fees = await client.finding.findFirstOrThrow({ where: { userId } });
    const d = findingOfType("duplicate_charge");
    const dup = await client.finding.create({
      data: {
        userId,
        type: d.type,
        key: d.key,
        title: d.title,
        annualSavingsCents: d.annualSavingsCents,
        amountCents: d.amountCents,
        confidence: d.confidence,
        evidence: d.evidence as Prisma.InputJsonObject,
      },
    });
    const done = async (
      finding: { id: string; type: FindingType; title: string },
      data: { completedAt: Date; confirmedAnnualCents: number; savingMissedAt?: Date },
    ) => {
      const decision = await client.decision.create({
        data: {
          userId,
          findingId: finding.id,
          choice: "yes",
          cardSnapshot: { title: finding.title, annualSavingsCents: 1, findingType: finding.type },
        },
      });
      await client.action.create({
        data: {
          userId,
          decisionId: decision.id,
          type: ACTION_FOR_FINDING[finding.type],
          status: "done",
          ...data,
        },
      });
    };
    // Finished this week: counts.
    await done(fees, {
      completedAt: new Date("2026-10-17T00:00:00Z"),
      confirmedAnnualCents: 5_000,
    });
    // Finished in July, and the saving never showed up.
    await done(dup, {
      completedAt: new Date("2026-07-01T00:00:00Z"),
      confirmedAnnualCents: 9_000,
      savingMissedAt: new Date("2026-09-15T00:00:00Z"),
    });

    const run = await runDigests({ client, userIds: own(), now: MONDAY, dryRun: true, send });
    const preview = run.previews.find((p) => p.userId === userId);
    expect(await savedToDate(userId, { client })).toBe(5_000);
    expect(preview?.text).toContain("Saved so far (expected): about $50.00 a year");
  });

  // Real-user QA: someone who signed up on a Thursday got the weekly email that day and again
  // four days later. Their first one is their first Monday.
  it("waits for a new person's first Monday", async () => {
    const thursday = new Date("2026-10-22T20:00:00Z");
    await person("newcomer", { finding: true });
    await client.user.update({
      where: { id: ids.newcomer },
      data: { createdAt: new Date("2026-10-22T16:00:00Z") },
    });
    const first = await runDigests({ client, userIds: own(), now: thursday, dryRun: true, send });
    expect(first.previews.find((p) => p.userId === ids.newcomer)).toBeUndefined();
    const monday = await runDigests({
      client,
      userIds: own(),
      now: new Date("2026-10-26T22:00:00Z"),
      dryRun: true,
      send,
    });
    expect(monday.previews.find((p) => p.userId === ids.newcomer)).toBeDefined();
  });

  it("keeps a run to the people it's given", async () => {
    const outsider = await client.user.create({
      data: { email: `outsider-${suffix}@example.com`, digestEnabled: true },
    });
    try {
      await client.account.create({
        data: { userId: outsider.id, source: "csv", name: "Card", type: "credit" },
      });
      const f = findingOfType("bank_fees");
      await client.finding.create({
        data: {
          userId: outsider.id,
          type: f.type,
          key: f.key,
          title: f.title,
          annualSavingsCents: f.annualSavingsCents,
          amountCents: f.amountCents,
          confidence: f.confidence,
          evidence: f.evidence as Prisma.InputJsonObject,
          createdAt: new Date("2026-10-17T00:00:00Z"),
        },
      });
      const run = await runDigests({ client, userIds: own(), now: MONDAY, send });
      expect(run.users).toBe(own().length - 2);
      expect(sentTo()).not.toContain(outsider.email);
      expect(await client.digest.count({ where: { userId: outsider.id } })).toBe(0);
    } finally {
      await client.user.delete({ where: { id: outsider.id } });
    }
  });

  // The weekly "what changed" email never reaches sample data: trial people and people whose
  // only bank is the demo bank, whatever their settings say.
  it("never emails a trial person or a demo-bank-only account", async () => {
    const trial = await client.user.create({
      data: { id: `trial_${suffix}`, email: `t-${suffix}@try.jane.invalid`, digestEnabled: true },
    });
    ids.trial = trial.id;
    await person("demo", { finding: true, account: false });
    const item = await client.plaidItem.create({
      data: {
        userId: ids.demo,
        plaidItemId: `demo-${suffix}`,
        accessTokenEncrypted: "x",
        institutionName: "Demo Bank",
      },
    });
    await client.account.create({
      data: { userId: ids.trial, source: "csv", name: "Card", type: "credit" },
    });
    await client.account.create({
      data: {
        userId: ids.demo,
        source: "plaid",
        itemId: item.id,
        plaidAccountId: `acct-${suffix}`,
        name: "Demo checking",
        type: "depository",
      },
    });
    const f = findingOfType("bank_fees");
    await client.finding.create({
      data: {
        userId: ids.trial,
        type: f.type,
        key: f.key,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
        createdAt: new Date("2026-10-17T00:00:00Z"),
      },
    });

    const nextMonday = new Date("2026-11-02T22:00:00Z");
    const run = await runDigests({ client, userIds: [ids.trial, ids.demo], now: nextMonday, send });

    expect(run.users).toBe(0);
    expect(run.excluded).toEqual({ demo_only: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(await client.digest.count({ where: { userId: { in: [ids.trial, ids.demo] } } })).toBe(0);
  });

  it("keeps Resend's id, writes the audit log, and counts sends for the numbers page", async () => {
    await person("counted", { finding: true });
    send.mockResolvedValue({ id: `re_${suffix}` });

    await runDigests({ client, userIds: [ids.counted], now: MONDAY, send });

    const [digest] = await digestsOf("counted");
    expect(digest.resendId).toBe(`re_${suffix}`);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "system", id: null },
      "digest_sent",
      { type: "digest", id: digest.id },
      expect.objectContaining({ user_id: ids.counted, new_findings: 1, changes: 0 }),
    );
    expect(track).toHaveBeenCalledWith(
      ids.counted,
      "digest_sent",
      expect.objectContaining({ digest_id: digest.id }),
    );

    const before = await digestNumbers({ client, since: MONDAY });
    await client.digest.update({
      where: { id: digest.id },
      data: { emailOpenedAt: new Date("2026-10-20T08:00:00Z") },
    });
    const opened = await digestNumbers({ client, since: MONDAY });
    expect(opened.opened - before.opened).toBe(1);
    expect(opened.clicked - before.clicked).toBe(0);
    expect(opened.sent).toBe(before.sent);
  });
});
