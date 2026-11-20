import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { yearElapsed } from "@/planning/tax-income";
import { loadTaxEstimate } from "./tax-estimate";

// Manager's check on #2187 (11-20): interest is paid with payments, so a lender's year to date is as
// of the last payment when Plaid gives one (it does for student loans in production; Debug 2's
// sandbox loan said Nov 8, read Nov 20). Paced to the read day instead, $860.07 read as $971.91 for
// the year, not $1,009.40.

const url = process.env.TEST_DATABASE_URL;
const READ = new Date("2026-11-20T15:00:00Z");

describe.runIf(url)(
  "the estimate's loan interest and the last payment",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let userId: string;

    beforeAll(async () => {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
      const email = "tax-interest-last-payment-d2@example.com";
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
          lastPaymentDate: new Date("2026-11-08T00:00:00Z"),
          updatedAt: READ,
        },
      });
    });

    afterAll(async () => {
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    });

    it("paces the lender's year to date to its last payment", async () => {
      const view = await loadTaxEstimate(userId, { client, now: new Date("2026-11-20T20:00:00Z") });
      expect(view.input.studentLoanInterestCents).toBe(
        Math.round(86_007 / yearElapsed(2026, "2026-11-08")),
      );
    });
  },
);
