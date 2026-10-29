import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addDays } from "@/detection/units";
import { loadMonthClose } from "@/lib/close";
import { savingsLedger } from "@/lib/ledger";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";

// The monthly close against a real Postgres: a sample person's month (Maya, the renter, on the
// demo bank) has its parts from the ledger and the month's changes, each change with how sure
// Jane is, at most three chips; a person with nothing wrong gets the checkup instead.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-23T15:00:00Z");

describe.runIf(url)("the monthly close", { timeout: 240_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("closes a sample person's month from the ledger and the month's changes", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true, person: "renter" });
    made.push(trial.userId);
    await syncItem(trial.itemId, { client, now: NOW });
    const ledger = await savingsLedger(trial.userId, { client, now: NOW });

    // Every month a past win was verified or held in, its close lists it under Verified.
    const months = new Set(
      ledger.entries
        .flatMap((e) => [e.verifiedOn, e.heldOn])
        .flatMap((d) => (d ? [d.slice(0, 7)] : [])),
    );
    expect(months.size).toBeGreaterThan(0);
    for (const month of months) {
      const close = await loadMonthClose(trial.userId, month, { client, now: NOW });
      const keys = ledger.entries
        .filter((e) => [e.verifiedOn, e.heldOn].some((d) => d?.startsWith(month)))
        .map((e) => e.key);
      expect(close.verified.map((e) => e.key).sort()).toEqual([...keys].sort());
      expect(close.verifiedCents).toBe(close.verified.reduce((s, e) => s + e.cents, 0));
    }

    const october = await loadMonthClose(trial.userId, "2026-10", { client, now: NOW });
    expect(october.soFar).toBe(true);
    expect(october.chips.length).toBeLessThanOrEqual(3);
    for (const c of october.changed) {
      expect(c.date.startsWith("2026-10")).toBe(true);
      expect(c.sure).toMatch(/^(\d+%|\d+%\+|under \d+%)$/);
    }
    // What's open is the ledger's estimates and dones, nothing counted.
    expect(october.open.every((e) => e.state === "estimated" || e.state === "done")).toBe(true);
    expect(october.checkup.lines.length).toBeGreaterThan(0);
  });

  it("gives a person with nothing wrong the checkup", async () => {
    const user = await client.user.create({
      data: { email: `close-${crypto.randomUUID()}@example.com` },
    });
    made.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    // Four months of groceries and pay, no fees and no subscriptions.
    const rows = [];
    for (let week = 0; week < 17; week += 1) {
      const day = addDays("2026-10-20", -7 * week);
      rows.push({
        userId: user.id,
        accountId: account.id,
        source: "csv" as const,
        date: new Date(`${day}T00:00:00Z`),
        description: "TRADER JOE S #552 OAKLAND CA",
        amountCents: 9_000 + week * 37,
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      });
      if (week % 2 === 1) {
        rows.push({
          userId: user.id,
          accountId: account.id,
          source: "csv" as const,
          date: new Date(`${addDays(day, -2)}T00:00:00Z`),
          description: "ACME CORP PAYROLL",
          amountCents: -200_000,
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_SALARY",
        });
      }
    }
    await client.transaction.createMany({ data: rows });

    const close = await loadMonthClose(user.id, "2026-09", { client, now: NOW });
    expect(close).toMatchObject({
      quiet: true,
      allGood: true,
      soFar: false,
      chips: [],
      found: [],
      changed: [],
    });
    expect(close.checkup.lines.length).toBeGreaterThan(3);
    expect(close.checkup.passed).toBeGreaterThan(0);
    expect(close.checkup.found).toBe(0);
  });
});
