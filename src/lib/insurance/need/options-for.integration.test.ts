import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { demoPartner } from "@/lib/insurance/demo-partner";
import { liabilityNeedsFor, type NeedPolicy } from "./index";
import { optionsFor } from "./options-for";

// Options priced by the stand-in against a real, migrated Postgres (spec step 275): a person the
// stand-in answers for gets options; a person it doesn't (a real account) gets none.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("options for a need, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const car: NeedPolicy & { premiumCents: number; premiumFrequency: "monthly" } = {
    id: "p1",
    kind: "auto",
    status: "active",
    deductibleCents: 100_000,
    coverage: { bodilyInjuryPerPerson: 5_000_000, bodilyInjuryPerAccident: 10_000_000 },
    premiumCents: 14_200,
    premiumFrequency: "monthly",
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person() {
    const user = await client.user.create({
      data: { email: `ins-opt-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  const need = () =>
    liabilityNeedsFor({
      yearlyPayCents: null,
      dependants: 0,
      mortgageCents: 0,
      otherDebtCents: 0,
      mortgageYearsLeft: null,
      savingsCents: 0,
      cashCents: 0,
      netWorthCents: 20_000_000,
      workLifeCoverCents: 0,
      policies: [car],
    })[0];

  it("prices the variants through the stand-in and marks a pick", async () => {
    const me = await person();
    const set = await optionsFor(
      me,
      need(),
      car,
      { netWorthCents: 20_000_000 },
      { client, now: NOW, partner: demoPartner },
    );
    expect(set?.options.length).toBeGreaterThanOrEqual(2);
    expect(set?.options[0].isPick).toBe(true);
    expect(set?.policyId).toBe("p1");
    expect(set?.confidence?.percent).toBeLessThanOrEqual(80);
  });

  it("gives a person with no stand-in no options", async () => {
    const me = await person();
    expect(await optionsFor(me, need(), car, {}, { client, now: NOW, partner: null })).toBeNull();
    // And a real account (no demo bank) has no partner at all.
    expect(await optionsFor(me, need(), car, {}, { client, now: NOW })).toBeNull();
  });
});
