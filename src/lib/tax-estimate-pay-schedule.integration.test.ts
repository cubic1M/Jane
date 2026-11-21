import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadTaxEstimate } from "./tax-estimate";

// Debug 2, desktop sweep 11 (11-20): the federal estimate paced take-home pay over the share of the
// year the data covered, so the paydays a window happened to hold set the year, and on a linked bank
// it fell each day between paydays, while the Saver's Credit beside it read the pay schedule. A month
// with three paychecks of $688.40 every two weeks read $21,537.09 of pay on Nov 20 and $18,385.32 on
// Nov 26 with nothing new, where its schedule says $17,898.36; a year from before January paced Jan 1 – Nov 20 the same way. The estimate
// now counts pay on a schedule as the tax cards do.

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

async function person(
  client: PrismaClient,
  email: string,
  first: string,
  pay: number[],
  [cents, description]: readonly [number, string] = [
    -68_840,
    "UC DAVIS PAYROLL PPD ID: 9460001234",
  ],
) {
  await client.user.deleteMany({ where: { email } });
  const userId = (await client.user.create({ data: { email, createdAt: new Date(first) } })).id;
  const checking = await client.account.create({
    data: {
      userId,
      source: "plaid",
      name: "Plaid checking",
      type: "depository",
      subtype: "checking",
    },
  });
  await client.transaction.create({
    data: {
      userId,
      accountId: checking.id,
      source: "plaid",
      date: new Date(first),
      amountCents: 1_250,
      description: "STARBUCKS",
      pfcDetailed: "FOOD_AND_DRINK_COFFEE",
    },
  });
  for (const d of pay) {
    await client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "plaid",
        date: new Date(d),
        amountCents: cents,
        description,
        pfcDetailed: "INCOME_SALARY",
      },
    });
  }
  return userId;
}

const wagesOn = async (client: PrismaClient, userId: string, day: string) =>
  (await loadTaxEstimate(userId, { client, now: new Date(`${day}T20:00:00Z`) })).input.income
    .wagesCents;

describe.runIf(url)("the estimate's pay on its schedule", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let month: string;
  let year: string;
  let started: string;
  let fromStart: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    month = await person(client, "tax-pay-schedule-month-d2@example.com", "2026-10-16", [
      Date.UTC(2026, 9, 16),
      Date.UTC(2026, 9, 30),
      Date.UTC(2026, 10, 13),
    ]);
    const fridays: number[] = [];
    for (let d = Date.UTC(2025, 10, 14); d <= Date.UTC(2026, 10, 13); d += 14 * DAY)
      fridays.push(d);
    year = await person(client, "tax-pay-schedule-year-d2@example.com", "2025-11-14", fridays);
    // A TA's statements from Jun 1: the first paycheck Oct 1, then twice a month (manager, 11-20).
    const stanford = [-150_000, "STANFORD UNIV DES:PAYROLL ID:X"] as const;
    const days = (list: string[]) => list.map((d) => Date.parse(`${d}T00:00:00Z`));
    started = await person(
      client,
      "tax-pay-schedule-started-d2@example.com",
      "2026-06-01",
      days(["2026-10-01", "2026-10-15", "2026-10-30", "2026-11-13"]),
      stanford,
    );
    fromStart = await person(
      client,
      "tax-pay-schedule-from-start-d2@example.com",
      "2026-06-01",
      days([
        "2026-06-01",
        "2026-06-15",
        "2026-07-01",
        "2026-07-15",
        "2026-07-31",
        "2026-08-14",
        "2026-09-01",
        "2026-09-15",
        "2026-10-01",
        "2026-10-15",
        "2026-10-30",
        "2026-11-13",
      ]),
      stanford,
    );
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [month, year, started, fromStart] } } });
    await client.$disconnect();
  });

  it("a month of data: 26 paychecks a year, the same on Nov 20 and Nov 26", async () => {
    // $688.40 every two weeks as a month (26 / 12), as a year: what the Saver's Credit grosses up.
    expect(await wagesOn(client, month, "2026-11-20")).toBe(149_153 * 12);
    expect(await wagesOn(client, month, "2026-11-26")).toBe(149_153 * 12);
  });

  it("a year from before January: what was paid and the paydays left", async () => {
    // 23 paychecks from Jan 9 to Nov 13, and Nov 27, Dec 11 and Dec 25 to come.
    expect(await wagesOn(client, year, "2026-11-20")).toBe(26 * 68_840);
    expect(await wagesOn(client, year, "2026-11-26")).toBe(26 * 68_840);
  });

  it("a job that began in the data: what it paid and its paydays left, as the tax cards read it", async () => {
    // 4 paid, then Dec 1, Dec 15 and Jan 1's paid Dec 31 (student-year-job-starts.test.ts).
    expect(await wagesOn(client, started, "2026-11-20")).toBe(7 * 150_000);
  });

  it("pay from the data's first days: a month of its schedule as a year", async () => {
    expect(await wagesOn(client, fromStart, "2026-11-20")).toBe(2 * 150_000 * 12);
  });
});
