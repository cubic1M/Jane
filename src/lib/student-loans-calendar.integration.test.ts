import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadStudentLoans } from "./student-loans";

// Debug 3's calendar sweep (11-19, frozen data read 40 days after its last sync): the year of pay
// the student loan plans use was counted back from today, so it moved the day an old paycheck left
// the year, with nothing new in the data. Counted back from where the statements end, it holds.

const url = process.env.TEST_DATABASE_URL;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe.runIf(url)("the plans' year of pay on frozen data", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: { email: `student-calendar-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const checking = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 300_000,
      },
    });
    const loan = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Federal student loan",
        type: "loan",
        subtype: "student",
        currentBalanceCents: 2_400_000,
      },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: loan.id,
        kind: "student",
        aprBps: 550,
        minimumPaymentCents: 16_000,
      },
    });
    // Fourteen months of pay every two weeks to Jan 22, 2027; the last row is Jan 28.
    const rows = [
      ...Array.from({ length: 31 }, (_, i) => ({
        date: addDays("2025-11-21", i * 14),
        amountCents: -(150_000 + (i % 3) * 1_000),
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_WAGES",
        description: "ACME CORP PAYROLL",
      })),
      {
        date: "2027-01-28",
        amountCents: 4_200,
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
        description: "SAFEWAY #1234",
      },
    ];
    let n = 0;
    for (const r of rows) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          dedupeKey: String(n++),
          date: new Date(`${r.date}T12:00:00Z`),
          amountCents: r.amountCents,
          description: r.description,
          merchantName: null,
          pfcPrimary: r.pfcPrimary,
          pfcDetailed: r.pfcDetailed,
          categorySource: "plaid",
        },
      });
    }
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  // Mar 14, 2027 is the first day a year back from today leaves out the Mar 13, 2026 paycheck.
  it("is the same on four days in a row", async () => {
    const agi = [];
    for (const day of ["2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15"]) {
      agi.push(
        (await loadStudentLoans(userId, { client, now: new Date(`${day}T20:00:00Z`) })).agiCents,
      );
    }
    expect(agi[0]).toBeGreaterThan(0);
    expect(new Set(agi).size).toBe(1);
  });
});
