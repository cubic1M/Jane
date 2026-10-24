import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { confirmFound, loadTaxProfile } from "@/lib/tax-profile";
import { startTrial } from "@/lib/trial";

// Dependants (area plan walk): a sample person arrives with their tax profile answered, and a
// real person is offered the children in the household they listed for insurance, to say yes
// to with one tap.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("dependants on the tax profile", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("gives the sample family their two children and family details", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true, person: "family" });
    created.push(trial.userId);
    await syncItem(trial.itemId, { client, now: NOW, progressive: true });
    const view = await loadTaxProfile(trial.userId, { client, now: NOW });
    expect(view.filingStatus).toEqual({ status: "yours", value: "married_joint" });
    expect(view.dependants).toMatchObject({ status: "yours", childrenUnder17: 2 });
    const stored = await client.taxProfile.findUniqueOrThrow({ where: { userId: trial.userId } });
    expect(stored.familyChildren).toHaveLength(2);
    expect(stored.spouseWagesCents).toBeGreaterThan(0);
    const estimate = (await loadTaxEstimate(trial.userId, { client, now: NOW }))!;
    expect(estimate.assumptions.join(" ")).not.toMatch(/dependants/);
  }, 120_000);

  it("offers a real person the children in their household, and one tap saves them", async () => {
    const user = await client.user.create({
      data: { email: `dependants-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, now: NOW });
    await client.insuranceProfile.create({
      data: {
        userId: user.id,
        people: [
          { name: "Sam", relation: "spouse", driver: true, age: 38 },
          { name: "Ana", relation: "child", driver: false, age: 6 },
        ],
      },
    });
    const before = await loadTaxProfile(user.id, { client, now: NOW });
    expect(before.dependants).toMatchObject({ status: "found", childrenUnder17: 1 });
    const estimate = (await loadTaxEstimate(user.id, { client, now: NOW }))!;
    expect(estimate.assumptions.join(" ")).toMatch(/1 child under 17 in your household/);

    const after = await confirmFound(user.id, "dependants", { client, now: NOW, via: "page" });
    expect(after.dependants).toMatchObject({
      status: "yours",
      childrenUnder17: 1,
      otherDependants: 0,
    });
  }, 120_000);
});
