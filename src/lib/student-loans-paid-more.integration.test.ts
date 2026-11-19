import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadStudentLoans } from "./student-loans";

// Debugger 11-18 (r353, Plaid S3: a federal loan of $14,688.10 at 5.50% whose bank reports a $25.00
// minimum, and $231.40 paid to MOHELA each month, on a phone): "what's my student loan balance?"
// listed "Your plan now: $25.00 a month, not paid off in 50 years" beside "3 qualifying payments
// counted (3 I've seen you make)". What's been paid is the plan now when it's more.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T20:00:00Z");

describe.runIf(url)("a student loan paid above its minimum", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: { email: `student-paid-more-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const checking = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 240_000,
      },
    });
    const loan = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Federal student loan",
        type: "loan",
        subtype: "student",
        currentBalanceCents: 1_468_810,
      },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: loan.id,
        kind: "student",
        aprBps: 550,
        minimumPaymentCents: 2_500,
      },
    });
    let n = 0;
    for (const d of ["2026-08-18", "2026-09-18", "2026-10-18"]) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          dedupeKey: String(n++),
          date: new Date(`${d}T12:00:00Z`),
          amountCents: 23_140,
          description: "MOHELA",
          merchantName: "MOHELA",
          pfcPrimary: "LOAN_PAYMENTS",
          pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
          categorySource: "plaid",
        },
      });
    }
    for (const d of [
      "2026-08-14",
      "2026-08-28",
      "2026-09-11",
      "2026-09-25",
      "2026-10-09",
      "2026-10-23",
      "2026-11-06",
    ]) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          dedupeKey: String(n++),
          date: new Date(`${d}T12:00:00Z`),
          amountCents: -165_000,
          description: "BLUE BOTTLE PAYROLL",
          merchantName: null,
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_WAGES",
          categorySource: "plaid",
        },
      });
    }
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is what's been paid, which pays it off", async () => {
    const data = await loadStudentLoans(userId, { client, now: NOW });
    const now = data.comparison?.results.find((r) => r.plan === "current");
    expect(now?.monthlyNowCents).toBe(23_140);
    expect(now?.leftCents).toBe(0);
  });
});
