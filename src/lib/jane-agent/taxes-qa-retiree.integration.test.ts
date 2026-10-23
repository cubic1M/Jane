import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadMultiYear } from "@/lib/multi-year";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxSavings } from "@/lib/tax-savings";

// Taxes QA (2026-10-22): Ruth's estimate left out her Social Security and her IRA withdrawals
// ("about even", while her Social Security suggestion said about $1,576 was due); she was told
// to sign up for a health FSA at work; and a Roth conversion said it was taxed at 12% when her
// Social Security makes each converted dollar cost more.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("a retiree's taxes against a real database", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `qa-retiree-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: "retiree" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("counts her Social Security's taxable part and her IRA withdrawals", async () => {
    const v = await loadTaxEstimate(userId, { client, now: NOW });
    expect(v.input.income.socialSecurityBenefitsCents).toBeGreaterThan(3_000_000);
    expect(v.estimate.socialSecurityTaxableCents).toBeGreaterThan(1_000_000);
    expect(v.estimate.totalTaxCents).toBeGreaterThan(150_000);
    expect(v.assumptions.join(" ")).toMatch(
      /Your Social Security comes to about \$[\d,.]+ this year/,
    );
    expect(v.assumptions.join(" ")).toMatch(
      /Withdrawals from your IRA \(about \$[\d,.]+ this year\)/,
    );
  });

  it("offers no health FSA to someone with no job, and gives a Roth conversion's real rate", async () => {
    const savings = await loadTaxSavings(userId, { client, now: NOW });
    expect(savings.savings.map((s) => s.key)).not.toContain("health_fsa");
    const years = await loadMultiYear(userId, { client, now: NOW });
    const roth = years.moves.find((m) => m.kind === "roth");
    if (roth)
      expect(roth.why).toMatch(
        /with your Social Security each converted dollar also makes more of it taxable/,
      );
  });
});
