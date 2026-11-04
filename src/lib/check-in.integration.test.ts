import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { summaryFor, type CheckIn } from "./check-in";

// Debugger 11-04: a person uploaded their checking statement, then their card. The month's summary was
// written once and kept: "In October you spent $2,504.99" beside $3,220.34 everywhere else.
const url = process.env.TEST_DATABASE_URL;

const month = (spendingCents: number): CheckIn =>
  ({
    month: "2026-10",
    spendingCents,
    previousSpendingCents: 514_412,
    incomeCents: 560_122,
    debtPaymentsCents: 0,
    budgets: [],
    netWorth: null,
    found: { findings: 0, annualSavingsCents: 0 },
    savedCents: 0,
    categories: [],
    changes: [],
    previousMonth: "2026-09",
  }) as unknown as CheckIn;

describe.runIf(url)("the month's stored summary", { timeout: 30_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const claude = null as never;
  beforeAll(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  const person = async () => {
    const user = await client.user.create({
      data: { email: `check-in-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };

  it("is written again when the month's figures change, and says the new ones", async () => {
    const userId = await person();
    const before = await summaryFor(userId, month(250_499), { client, claude });
    expect(before).toContain("$2,504.99");
    const after = await summaryFor(userId, month(322_034), { client, claude });
    expect(after).toContain("$3,220.34");
    expect(after).not.toContain("$2,504.99");
    const stored = await client.checkIn.findMany({ where: { userId } });
    expect(stored).toHaveLength(1);
    expect(stored[0].summary).toBe(after);
  });

  it("is kept while its figures still hold", async () => {
    const userId = await person();
    const first = await summaryFor(userId, month(322_034), { client, claude });
    await client.checkIn.updateMany({
      where: { userId },
      data: { summary: `${first} A word Claude chose.` },
    });
    expect(await summaryFor(userId, month(322_034), { client, claude })).toBe(
      `${first} A word Claude chose.`,
    );
  });
});
