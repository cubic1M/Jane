import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { correctFact } from "@/lib/profile";
import { loadToldDependency } from "./tax-dependency";
import { DEPENDENCY_UNKNOWN_LINE, loadTaxEstimate } from "./tax-estimate";

// Tax T5: the estimate's standard deduction for someone another person can claim as a dependent is
// limited (Pub. 501), and for someone who has not said it is the full amount, said in a line.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");

describe.runIf(url)(
  "the standard deduction and the person's dependency",
  { timeout: 300_000 },
  () => {
    let client: PrismaClient;
    let id: string;

    const view = () => loadTaxEstimate(id, { client, now: NOW });
    const say = async (value: string | null) => {
      if (value === null)
        await client.janePreference.deleteMany({
          where: { userId: id, kind: "fact", key: "profile:claimed_as_dependent" },
        });
      else await correctFact(id, "claimed_as_dependent", value, { client, now: NOW });
    };

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
      id = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
      await client.taxCorrection.create({
        data: { userId: id, year: 2026, kind: "wages", label: "Pay", cents: 1_000_000 },
      });
      // 20 years old on the day: 20 at the year's end.
      await client.investorProfile.upsert({
        where: { userId: id },
        create: { userId: id, age: 20, ageOn: NOW },
        update: { age: 20, ageOn: NOW },
      });
    });

    afterAll(async () => {
      await deleteCheckPerson(id, { client }).catch(() => {});
      await client.$disconnect();
    });

    it("reads yes, no, and 'not sure' as unknown", async () => {
      await say(null);
      expect(await loadToldDependency(id, { client })).toBeNull();
      await say("yes");
      expect(await loadToldDependency(id, { client })).toBe(true);
      await say("no");
      expect(await loadToldDependency(id, { client })).toBe(false);
      await say("unsure");
      expect(await loadToldDependency(id, { client })).toBeNull();
    });

    it("takes the full standard deduction and says so for someone under 24 who has not said", async () => {
      await say(null);
      const v = await view();
      expect(v.estimate.deduction.standardCents).toBe(1_610_000);
      expect(v.assumptions.filter((a) => a === DEPENDENCY_UNKNOWN_LINE)).toHaveLength(1);
      await say("unsure");
      expect((await view()).assumptions).toContain(DEPENDENCY_UNKNOWN_LINE);
    });

    it("limits the deduction for a dependent and drops the line", async () => {
      await say("no");
      const no = await view();
      expect(no.estimate.deduction.standardCents).toBe(1_610_000);
      expect(no.assumptions).not.toContain(DEPENDENCY_UNKNOWN_LINE);

      await say("yes");
      const yes = await view();
      // The pay is projected to a full year, so compare with the earned income the estimate itself saw.
      const earned = yes.estimate.totalIncomeCents;
      expect(yes.estimate.deduction.standardCents).toBe(
        Math.min(1_610_000, Math.max(135_000, earned + 45_000)),
      );
      expect(yes.estimate.deduction.standardCents).toBeLessThanOrEqual(1_610_000);
      expect(yes.assumptions).not.toContain(DEPENDENCY_UNKNOWN_LINE);
    });

    it("reads the age at the requested year's end: told 65 now, 64 at the end of last year", async () => {
      // Told 65 on 2026-11-05: 65 at the end of 2026, but 64 at the end of 2025.
      await client.investorProfile.update({ where: { userId: id }, data: { age: 65, ageOn: NOW } });
      await say("no");
      const current = await loadTaxEstimate(id, { client, now: NOW, year: 2026 });
      const before = await loadTaxEstimate(id, { client, now: NOW, year: 2025 });
      // 2026 single: 16,100 + 2,050; 2025 single: 15,750 and no extra amount.
      expect(current.estimate.deduction.standardCents).toBe(1_815_000);
      expect(before.estimate.deduction.standardCents).toBe(1_575_000);
    });
  },
);
