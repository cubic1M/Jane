import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { yearElapsed } from "@/planning/tax-income";
import { loadTaxEstimate } from "./tax-estimate";

// Debug 2 re-walk (11-16, Plaid sandbox default user, 1280 light): the student loan's lender
// reported $3,119.50 of interest paid this year, and Taxes' audit records said "Student loan
// interest $6,432.87": the year to date was paced over the 177 days since the linked data's first
// line (May 23), though the lender counts from January 1.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T17:00:00Z");

describe.runIf(url)("student loan interest from the lender", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: "tax-loan-interest-d2@example.com", createdAt: NOW },
    });
    userId = user.id;
    const checking = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
      },
    });
    // Pay every two weeks from May 23: the linked data starts then.
    for (let d = Date.UTC(2026, 4, 23); d <= Date.UTC(2026, 10, 14); d += 14 * 86_400_000) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          date: new Date(d),
          amountCents: -81_000,
          description: "Sweetgreen inc payroll ppd id",
          pfcDetailed: "INCOME_SALARY",
        },
      });
    }
    const loan = await client.account.create({
      data: { userId, source: "plaid", name: "Plaid student", type: "loan", subtype: "student" },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: loan.id,
        kind: "student",
        aprBps: 525,
        ytdInterestPaidCents: 311_950,
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("paces the lender's year to date by the calendar, not by when the data starts", async () => {
    const view = await loadTaxEstimate(userId, { client, now: NOW });
    expect(view.input.studentLoanInterestCents).toBe(
      Math.round(311_950 / yearElapsed(2026, "2026-11-16")),
    );
    expect(view.input.studentLoanInterestCents).toBeLessThan(360_000);
  });
});
