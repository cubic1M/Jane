import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { studentReply } from "@/lib/jane-agent/student-replies";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadStudentLoans } from "./student-loans";
import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// Connectors lane, Plaid sandbox walk with Liabilities (11-17): a student loan came through, the
// accounts had no paychecks, and /loans/student said "At $0.00 a year (estimated from your
// paychecks …)", so IBR read $0 a month with $133,786.80 forgiven. No pay seen is an income
// nobody knows, not an estimate of $0.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("student loans when no paycheck is seen", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `student-no-pay-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    // The demo bank's paychecks gone: a loan, and no pay in the accounts.
    await client.transaction.deleteMany({
      where: { userId, pfcDetailed: { in: ["INCOME_SALARY", "INCOME_WAGES"] } },
    });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("says the income is unknown, not estimated from paychecks", async () => {
    const data = await loadStudentLoans(userId, { client, now: LINKED });
    expect(data.loan).not.toBeNull();
    expect(data.agiCents).toBe(0);
    expect(data.agiFrom).toBe("none");
  });

  it("the chat says it sees no paychecks", async () => {
    const body = studentReply(await loadStudentLoans(userId, { client, now: LINKED })).body;
    expect(body).not.toContain("estimated from your paychecks");
    expect(body).toContain("I see no paychecks in your accounts");
  });
});
