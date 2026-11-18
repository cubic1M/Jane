import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadPlansArea } from "./plans-load";

// Debugger 11-17 (r336, 14 months of Wells Fargo checking paying Nelnet $210.40 a month, on a
// phone): Plans & goals read "Good: Net worth $3.4k, Down $154 since the end of last month", while
// Home said "Not counting what you owe on Nelnet Loan Payment Student Ln: Jane sees the payments,
// not the balance." The tree's own rule is never a figure that silently leaves a debt out; a loan
// seen only in its payments is one.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T23:00:00Z");
const EMAIL = "plans-loan-left-out@example.test";

describe.runIf(url)("net worth on Plans & goals", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.user.deleteMany({ where: { email: EMAIL } });
    userId = (await client.user.create({ data: { email: EMAIL, timezone: "America/Los_Angeles" } }))
      .id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Wells Fargo checking",
        type: "depository",
        currentBalanceCents: 341_218,
      },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "csv",
        dedupeKey: "nelnet",
        date: new Date("2026-11-01T12:00:00Z"),
        amountCents: 21_040,
        description: "NELNET LOAN PAYMENT STUDENT LN",
        merchantName: "Nelnet",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
        categorySource: "rule",
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("says it isn't counting a loan seen only in its payments", async () => {
    const { area } = await loadPlansArea(userId, { client, now: NOW });
    const worth = area.tree.branches.find((b) => b.id === "worth")!.items[0];
    expect([worth.label, worth.status]).toEqual(["Net worth, not counting a loan", "look"]);
    expect(area.summaries[worth.id]).toBe(
      "Not counting what you owe on Nelnet: Jane sees the payments, not the balance.",
    );
  });
});
