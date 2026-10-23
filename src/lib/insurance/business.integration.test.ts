import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { gapQuotes } from "./risks";
import { loadInsurance } from "./profile";

// Business and side-gig cover against a real, migrated Postgres (spec step 201): the tax
// profile's self-employment, freelance income, business miles and equipment bring business
// gaps into the profile; personal policies don't close them; a business policy does; and the
// stand-in partner quotes the cover.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("business cover, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const o = () => ({ client, now: NOW });

  const policy = (
    userId: string,
    kind: string,
    carrier: string,
    coverage: Record<string, number | boolean> = {},
  ) =>
    client.insurancePolicy.create({
      data: {
        userId,
        kind,
        carrier,
        source: "typed",
        status: "active",
        premiumCents: 5_000,
        premiumFrequency: "monthly",
        coverage,
      },
    });

  async function freelancer() {
    const user = await client.user.create({
      data: { email: `ins-biz-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 500_000,
      },
    });
    const tx = (key: string, date: string, amountCents: number, pfcDetailed: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: key,
          date: new Date(date),
          amountCents,
          description: key,
          pfcDetailed,
          pfcPrimary: pfcDetailed.split("_")[0],
        },
      });
    await tx("client-pay", "2026-09-01", -800_000, "INCOME_CONTRACTOR");
    await tx("laptop", "2026-08-10", 189_900, "GENERAL_MERCHANDISE_ELECTRONICS");
    await client.taxProfile.create({
      data: {
        userId: user.id,
        incomeKinds: ["self_employed"],
        businessMiles: 2_400,
        businessMilesYear: 2026,
      },
    });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("brings the gaps into the profile, and personal policies don't close them", async () => {
    const me = await freelancer();
    const keys = async () => (await loadInsurance(me, o())).gaps.map((g) => g.key);
    expect(await keys()).toEqual(
      expect.arrayContaining([
        "business_liability",
        "professional_liability",
        "business_equipment",
      ]),
    );
    // Car business use needs a car policy to be about.
    await policy(me, "auto", "GEICO");
    await policy(me, "home", "Lemonade");
    const after = await keys();
    expect(after).toEqual(
      expect.arrayContaining([
        "business_liability",
        "professional_liability",
        "business_equipment",
        "car_business_use",
      ]),
    );
  });

  it("closes with a business policy, and the partner quotes the cover", async () => {
    const me = await freelancer();
    await policy(me, "business", "Hiscox", {
      generalLiability: 100_000_000,
      professionalLiability: 100_000_000,
      businessProperty: 500_000,
    });
    const gaps = (await loadInsurance(me, o())).gaps.map((g) => g.key);
    expect(gaps).not.toContain("business_liability");
    expect(gaps).not.toContain("professional_liability");
    expect(gaps).not.toContain("business_equipment");
  });

  it("quotes business cover through the stand-in partner for a demo-bank person", async () => {
    const me = await freelancer();
    // No demo bank, no partner: nothing is made up.
    expect(await gapQuotes(me, "business", o())).toEqual([]);
  });
});
