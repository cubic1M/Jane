import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The trading agent is demo advice's; this person stands in for one.
vi.mock("@/lib/advice-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/advice-mode")>()),
  adviceMode: vi.fn(async () => true),
}));

import { scopedFor } from "./db-scoped";
import { FamilyCreditError, addFamilyCredit } from "./family-credit";
import { FamilyTaxesError, saveFamilyDetails } from "./family-taxes";
import { setBrokerageBalance } from "./investing/brokerage-balance";
import { CostlyProductError, saveProduct } from "./investments/costly-products";
import { FamilyFileError, saveBeneficiaries } from "./investments/family-file";
import { TaxProfileError, savePayStub } from "./tax-profile";
import { AgentError, startTradingAgent } from "./trading-agent/agent";

// Amounts past what a column keeps (32 bits of cents) failed their save with a server error, and a
// typed balance left its account made with nothing in it. Each is now refused in words. Against a
// real Postgres.

const url = process.env.TEST_DATABASE_URL;
const HUGE = 3_000_000_000;

describe.runIf(url)("what a form takes", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `bounds-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("refuses a balance too large to keep, and makes no account for it", async () => {
    expect(await setBrokerageBalance(scopedFor(userId, client), "Robinhood", HUGE)).toBeNull();
    expect(await client.account.count({ where: { userId } })).toBe(0);
  });

  it("refuses amounts too large to keep, in words", async () => {
    await expect(
      savePayStub(
        userId,
        {
          asOf: "2026-10-31",
          grossCents: HUGE,
          federalCents: 0,
          stateCents: 0,
          retirementCents: 0,
          pretaxCents: 0,
        },
        { client, via: "page" },
      ),
    ).rejects.toBeInstanceOf(TaxProfileError);
    await expect(
      addFamilyCredit(userId, { kind: "cosigned", person: "Sam", balanceCents: HUGE }, { client }),
    ).rejects.toBeInstanceOf(FamilyCreditError);
    await expect(
      saveFamilyDetails(
        userId,
        { children: [], spouseWagesCents: HUGE, paysOverHalfHome: null, student: null },
        { client, via: "page" },
      ),
    ).rejects.toBeInstanceOf(FamilyTaxesError);
    await expect(
      saveProduct(
        userId,
        {
          kind: "annuity",
          name: "Annuity",
          provider: "Co",
          value: "30000000",
          feePercent: "1",
          premiumYearly: "",
          purchasedYear: "2020",
          purchasedMonth: "1",
          schedule: "",
        },
        { client },
      ),
    ).rejects.toBeInstanceOf(CostlyProductError);
  });

  it("refuses beneficiary shares outside 1 to 100", async () => {
    const account = await client.account.create({
      data: { userId, source: "csv", name: "IRA", type: "investment" },
    });
    await expect(
      saveBeneficiaries(
        userId,
        account.id,
        [
          { name: "A", relationship: "child", sharePct: 200, tier: "primary" },
          { name: "B", relationship: "child", sharePct: -100, tier: "primary" },
        ],
        { client },
      ),
    ).rejects.toBeInstanceOf(FamilyFileError);
    expect(await client.accountBeneficiary.count({ where: { accountId: account.id } })).toBe(0);
  });

  it("takes only the trading agent's own intervals", async () => {
    for (const interval of ["toString", "constructor"]) {
      await expect(
        startTradingAgent(
          userId,
          { policy: "catalog:vol_target@BTC/USD", interval: interval as never },
          { client },
        ),
      ).rejects.toThrow(new AgentError("Pick a strategy and how often it runs."));
    }
  });
});
