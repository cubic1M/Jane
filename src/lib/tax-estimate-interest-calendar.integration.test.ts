import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { yearElapsed } from "@/planning/tax-income";
import { loadTaxEstimate } from "./tax-estimate";

// Gate C's calendar sweep (11-20, frozen data, 12-01 to 12-31): the lender's year to date was paced
// by today, so with no new reading the year's student loan interest fell every day. It's paced by
// the day the lender's figure was read (the liability row's last write).

const url = process.env.TEST_DATABASE_URL;
const READ = new Date("2026-11-20T15:00:00Z");

describe.runIf(url)("the estimate's loan interest on the calendar", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const email = "tax-interest-calendar-d2@example.com";
    await client.user.deleteMany({ where: { email } });
    userId = (await client.user.create({ data: { email, createdAt: READ } })).id;
    const checking = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
      },
    });
    for (let d = Date.UTC(2026, 6, 24); d <= Date.UTC(2026, 10, 13); d += 14 * 86_400_000) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          date: new Date(d),
          amountCents: -86_120,
          description: "TARGET CORP PAYROLL PPD",
          pfcDetailed: "INCOME_SALARY",
        },
      });
    }
    const loan = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid student",
        type: "loan",
        subtype: "student",
        currentBalanceCents: 1_605_374,
      },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: loan.id,
        kind: "student",
        aprBps: 550,
        ytdInterestPaidCents: 86_007,
        updatedAt: READ,
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is the same on 12-01, 12-15 and 12-31 with no new reading", async () => {
    const figures = [];
    for (const day of ["2026-12-01", "2026-12-15", "2026-12-31"]) {
      const view = await loadTaxEstimate(userId, { client, now: new Date(`${day}T20:00:00Z`) });
      figures.push(view.input.studentLoanInterestCents);
    }
    const paced = Math.round(86_007 / yearElapsed(2026, "2026-11-20"));
    expect(figures).toEqual([paced, paced, paced]);
  });
});
