import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { age25to64 } from "@/planning/student-tax";
import { correctFact } from "@/lib/profile";
import {
  birthdayLine,
  LIVED_WITH_SPOUSE_UNKNOWN_LINE,
  loadTaxEstimate,
  OVER_25_ONLY_LINE,
  UNDER_25_ONLY_LINE,
} from "./tax-estimate";

// Tax T6 through the loader: Social Security on a separate return reads whether the person lived
// with their spouse; "25 or older" is read the way the earned income credit card reads it; and an age
// of 64 says what a January 1 birthday would change.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T17:00:00Z");

describe.runIf(url)("Social Security, age and the loader", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const say = (key: Parameters<typeof correctFact>[1], value: string) =>
    correctFact(userId, key, value, { client, now: NOW });
  const view = () => loadTaxEstimate(userId, { client, now: NOW, year: 2026 });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: "tax-ss-age-t6@example.com", createdAt: NOW },
    });
    userId = user.id;
    const checking = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
      },
    });
    // Pay every two weeks, and Social Security every month.
    for (let d = Date.UTC(2026, 0, 2); d <= Date.UTC(2026, 10, 13); d += 14 * 86_400_000) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          date: new Date(d),
          amountCents: -60_000,
          description: "Sweetgreen inc payroll ppd id",
          pfcDetailed: "INCOME_SALARY",
        },
      });
    }
    for (let m = 0; m < 10; m++) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          date: new Date(Date.UTC(2026, m, 3)),
          amountCents: -150_000,
          description: "SSA TREAS 310 XXSOC SEC",
          pfcDetailed: "INCOME_OTHER_INCOME",
        },
      });
    }
  });

  afterAll(async () => {
    try {
      if (userId) await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await client.$disconnect();
    }
  });

  it("counts 85% of the benefits, base $0, for a separate return unless they lived apart all year", async () => {
    await say("filing_status", "married_separate");
    const unknown = await view();
    expect(unknown.input.livedWithSpouse).toBeUndefined();
    expect(unknown.estimate.socialSecurityTaxableCents).toBeGreaterThan(0);
    expect(unknown.assumptions).toContain(LIVED_WITH_SPOUSE_UNKNOWN_LINE);

    await say("lived_with_spouse", "yes");
    const together = await view();
    expect(together.input.livedWithSpouse).toBe(true);
    expect(together.estimate.socialSecurityTaxableCents).toBe(
      unknown.estimate.socialSecurityTaxableCents,
    );
    expect(together.assumptions).not.toContain(LIVED_WITH_SPOUSE_UNKNOWN_LINE);

    await say("lived_with_spouse", "no");
    const apart = await view();
    expect(apart.input.livedWithSpouse).toBe(false);
    // The single base ($25,000) is higher than the $0 of living together.
    expect(apart.estimate.socialSecurityTaxableCents).toBeLessThan(
      together.estimate.socialSecurityTaxableCents,
    );
    expect(apart.assumptions).not.toContain(LIVED_WITH_SPOUSE_UNKNOWN_LINE);
  });

  it("reads '25 or older: yes' as the earned income card does, and says what is still not known", async () => {
    await say("filing_status", "single");
    await client.investorProfile.deleteMany({ where: { userId } });
    await client.janePreference.deleteMany({
      where: { userId, kind: "fact", key: "profile:age_25_plus" },
    });
    const before = await view();
    expect(before.input.age).toBeNull();

    await say("age_25_plus", "yes");
    const after = await view();
    // The card's own reading of the same answer (age25to64) and the estimate's input agree.
    expect(age25to64({ age_25_plus: { value: "yes" } })).toBe(true);
    expect(after.input.age).toBe(25);
    expect(after.assumptions.some((a) => a.includes("Tell me your age and I'll check it"))).toBe(
      false,
    );
    expect(after.assumptions).toContain(OVER_25_ONLY_LINE);

    await say("age_25_plus", "no");
    const under = await view();
    expect(age25to64({ age_25_plus: { value: "no" } })).toBe(false);
    expect(under.input.age).toBe(24);
    expect(under.estimate.credits.earnedIncomeCreditCents).toBe(0);
    expect(under.assumptions).toContain(UNDER_25_ONLY_LINE);
    expect(under.assumptions).not.toContain(OVER_25_ONLY_LINE);
  });

  it("does not turn '25 or older' into age 25 for a person whose age range is 58 or more", async () => {
    await client.investorProfile.deleteMany({ where: { userId } });
    await say("age_25_plus", "yes");
    for (const band of ["58_to_65", "66_to_72", "73_plus"]) {
      await say("age_band", band);
      const v = await view();
      // The card says the same: 66 and over is outside 25 to 64, 58 to 65 is not known.
      expect(age25to64({ age_band: { value: band }, age_25_plus: { value: "yes" } })).not.toBe(
        true,
      );
      expect(v.input.age).toBeNull();
      expect(v.assumptions).not.toContain(OVER_25_ONLY_LINE);
    }
    // A range under 58 is 25 to 64 for the card, and for the estimate.
    await say("age_band", "30_to_49");
    expect((await view()).input.age).toBe(25);
  });

  it("says what a January 1 birthday would change for someone told as 64", async () => {
    await client.janePreference.deleteMany({
      where: { userId, kind: "fact", key: "profile:age_25_plus" },
    });
    await client.investorProfile.create({ data: { userId, age: 64, ageOn: NOW } });
    const v = await view();
    expect(v.input.age).toBe(64);
    expect(v.assumptions).toContain(birthdayLine(2026, 205_000));
  });
});
