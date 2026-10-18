import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { isFirstDetectionComplete, moneyFound, runDetection } from "./engine";

// Runs against a real, migrated Postgres: CI provides one; locally, point
// TEST_DATABASE_URL at a scratch database and run `npx prisma migrate deploy` on it.
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-10-15T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("runDetection against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  let otherUserId: string;
  let checkingId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({ data: { email: `detect-${suffix}@example.com` } });
    const other = await client.user.create({ data: { email: `other-${suffix}@example.com` } });
    userId = user.id;
    otherUserId = other.id;

    const checking = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Everyday Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 50_000,
      },
    });
    checkingId = checking.id;
    const row = (date: string, amountCents: number, description: string, pfcDetailed: string) => ({
      userId,
      accountId: checkingId,
      source: "csv" as const,
      dedupeKey: `${date}-${description}-${amountCents}`,
      date: day(date),
      amountCents,
      description,
      merchantName: null,
      pfcPrimary: pfcDetailed.startsWith("BANK_FEES") ? "BANK_FEES" : "ENTERTAINMENT",
      pfcDetailed,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        ...["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"].map((d) =>
          row(d, 1549, "NETFLIX.COM", "ENTERTAINMENT_TV_AND_MOVIES"),
        ),
        row("2026-05-04", 3400, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"),
        // Outside the 12-month window: never counted.
        row("2025-09-01", 3400, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"),
      ],
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await client.$disconnect();
  });

  const findingsOf = (id: string) =>
    client.finding.findMany({ where: { userId: id }, orderBy: [{ type: "asc" }, { key: "asc" }] });

  it("creates findings and marks first detection complete", async () => {
    expect(await isFirstDetectionComplete(userId, { client })).toBe(false);

    const summary = await runDetection(userId, { client, now: NOW });

    const findings = await findingsOf(userId);
    expect(findings.map((f) => [f.type, f.key, f.annualSavingsCents])).toEqual([
      ["subscription_review", "merchant:netflix", 18588],
      ["bank_fees", `account:${checkingId}`, 3400],
    ]);
    expect(summary.created).toBe(2);
    expect(await isFirstDetectionComplete(userId, { client })).toBe(true);
    expect(await findingsOf(otherUserId)).toEqual([]);
  });

  it("produces identical findings when run again", async () => {
    const before = await findingsOf(userId);

    const summary = await runDetection(userId, { client, now: NOW });

    expect(await findingsOf(userId)).toEqual(before);
    expect(summary).toMatchObject({ created: 0, updated: 0, resurfaced: 0 });
  });

  it("counts fees but not an unapproved subscription in money found", async () => {
    expect(await moneyFound(userId, { client })).toBe(3400);
  });

  it("keeps a declined finding declined until its amount moves more than 20%", async () => {
    await client.finding.updateMany({
      where: { userId, type: "bank_fees" },
      data: { status: "declined" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: checkingId,
        source: "csv",
        dedupeKey: "small-fee",
        date: day("2026-09-03"),
        amountCents: 300,
        description: "ATM FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_ATM_FEES",
        categorySource: "rule",
      },
    });

    await runDetection(userId, { client, now: NOW });
    const stillDeclined = await client.finding.findFirstOrThrow({
      where: { userId, type: "bank_fees" },
    });
    expect(stillDeclined).toMatchObject({ status: "declined", annualSavingsCents: 3400 });

    await client.transaction.create({
      data: {
        userId,
        accountId: checkingId,
        source: "csv",
        dedupeKey: "big-fee",
        date: day("2026-10-01"),
        amountCents: 3400,
        description: "OVERDRAFT FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
        categorySource: "rule",
      },
    });

    const summary = await runDetection(userId, { client, now: NOW });
    const back = await client.finding.findFirstOrThrow({ where: { userId, type: "bank_fees" } });
    expect(back).toMatchObject({ status: "new", annualSavingsCents: 7100 });
    expect(summary.resurfaced).toBe(1);
    expect(await client.finding.count({ where: { userId } })).toBe(2);
  });

  it("removes an undecided finding once it no longer applies", async () => {
    const later = new Date("2027-03-01T12:00:00Z");

    // By March 2027 the Netflix charges have stopped: the subscription card goes away,
    // while the declined-then-resurfaced fee finding is kept for its remaining fees.
    const summary = await runDetection(userId, { client, now: later });

    const findings = await findingsOf(userId);
    expect(findings.map((f) => f.type)).toEqual(["bank_fees"]);
    expect(summary.removed).toBe(1);
  });
});
