import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { sendToJane } from "./typing";

// Debugger 11-17 (r339, three months of Capital One 360 checking ending Sep 28, uploaded on Nov
// 17, chat on a phone): "do i have any subscriptions?" answered "I don't see any subscriptions
// yet" and "when do i get paid?" "I don't see a regular paycheck yet", though the statements pay
// Netflix every month and Target every two weeks. Statements that old read every charge as
// stopped; the answer says they end Sep 28, as safe to spend and net worth do.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T18:00:00Z");

describe.runIf(url)("subscriptions and payday on old statements", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `old-statements-recurring-${crypto.randomUUID()}@example.com`,
        timezone: "America/Chicago",
      },
    });
    userId = user.id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Capital One 360",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 195_016,
      },
    });
    let n = 0;
    const row = (
      date: string,
      amountCents: number,
      description: string,
      pfcPrimary: string,
      pfcDetailed: string,
    ) =>
      client.transaction.create({
        data: {
          userId,
          accountId: account.id,
          source: "csv",
          dedupeKey: String(n++),
          date: new Date(`${date}T12:00:00Z`),
          amountCents,
          description,
          merchantName: description,
          pfcPrimary,
          pfcDetailed,
          categorySource: "rule",
        },
      });
    for (const d of ["2026-07-14", "2026-08-14", "2026-09-14"]) {
      await row(d, 1_549, "Netflix", "ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES");
    }
    for (const d of [
      "2026-07-17",
      "2026-07-31",
      "2026-08-14",
      "2026-08-28",
      "2026-09-11",
      "2026-09-25",
    ]) {
      await row(d, -71_240, "Target Corp Payroll", "INCOME", "INCOME_WAGES");
    }
    await row("2026-09-28", -4, "Monthly Interest Paid", "INCOME", "INCOME_INTEREST_EARNED");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const ask = async (text: string) => (await sendToJane(userId, text, { client, now: NOW })).reply;

  it("says the statements end, not that there are none", async () => {
    const subs = await ask("do i have any subscriptions?");
    expect(subs.body).not.toContain("I don't see any subscriptions");
    expect(subs.body).toMatch(/^Your statements end Sep 28, 2026, so I can't say/);
    const payday = await ask("when do i get paid?");
    expect(payday.body).not.toContain("I don't see a regular paycheck");
    expect(payday.body).toMatch(/^Your statements end Sep 28, 2026, so I can't say/);
  });
});
