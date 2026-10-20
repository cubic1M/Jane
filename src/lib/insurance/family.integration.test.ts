import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { sharedReadFor } from "@/lib/db-scoped";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { FamilyError, addPerson, loadFamily, removePerson, setCovered, setShared } from "./family";
import { loadInsurance } from "./profile";

// The whole household's cover against a real, migrated Postgres (spec step 198): policies a
// partner shares show once and read-only, nothing unshared ever does, each person gets
// their gaps, and the family health comparison counts both employers' plans.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("the household's cover, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const o = () => ({ client, now: NOW });

  async function couple() {
    const make = async (name: string) => {
      const user = await client.user.create({
        data: { email: `ins-fam-${crypto.randomUUID()}@example.com`, name },
      });
      created.push(user.id);
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Checking",
          type: "depository",
          subtype: "checking",
          currentBalanceCents: 500_000,
        },
      });
      return user.id;
    };
    const [me, alex] = [await make("Casey"), await make("Alex")];
    const household = await client.household.create({ data: {} });
    await client.householdMember.createMany({
      data: [
        { householdId: household.id, userId: me },
        { householdId: household.id, userId: alex },
      ],
    });
    return { me, alex };
  }
  const health = (userId: string, carrier: string, premiumCents: number, source = "typed") =>
    client.insurancePolicy.create({
      data: {
        userId,
        kind: "health",
        carrier,
        source,
        status: "active",
        premiumCents,
        premiumFrequency: "monthly",
        deductibleCents: 150_000,
        coverage: { coinsurance: 20, outOfPocketMax: 600_000 },
      },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("shows a partner only the policies they switched on, read-only, and nothing to outsiders", async () => {
    const { me, alex } = await couple();
    const outsider = (
      await client.user.create({
        data: { email: `ins-fam-out-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    created.push(outsider);
    const shared = await health(alex, "Acme Corp", 20_000, "employer");
    await health(alex, "Private Plan", 55_000);
    await setShared(alex, shared.id, true, o());

    const seen = await (await sharedReadFor(me, client)).policies();
    expect(seen.map((p) => p.carrier)).toEqual(["Acme Corp"]);
    // Nothing the policy holder didn't choose to show: no document, no renewal, no number.
    expect(Object.keys(seen[0]).sort()).toEqual(
      [
        "carrier",
        "coverage",
        "covered",
        "deductibleCents",
        "id",
        "kind",
        "premiumCents",
        "premiumFrequency",
        "source",
        "userId",
      ].sort(),
    );
    expect(await (await sharedReadFor(outsider, client)).policies()).toEqual([]);
    // Stop sharing and it's gone again.
    await setShared(alex, shared.id, false, o());
    expect(await (await sharedReadFor(me, client)).policies()).toEqual([]);
    await expect(setShared(me, shared.id, true, o())).rejects.toThrow(FamilyError);
  });

  it("matches cover to each person, and points out the gaps for them", async () => {
    const { me } = await couple();
    const car = await client.insurancePolicy.create({
      data: {
        userId: me,
        kind: "auto",
        carrier: "GEICO",
        source: "typed",
        status: "active",
        premiumCents: 14_200,
        premiumFrequency: "monthly",
      },
    });
    await addPerson(me, { name: "Sam", relation: "child", driver: true, age: "16" }, o());
    await addPerson(me, { name: "Robin", relation: "spouse", driver: false, age: "41" }, o());
    await expect(
      addPerson(me, { name: "Sam", relation: "child", driver: false, age: "" }, o()),
    ).rejects.toThrow("same name");
    await expect(
      addPerson(me, { name: "Pat", relation: "cousin", driver: false, age: "" }, o()),
    ).rejects.toThrow(FamilyError);
    await health(me, "Bluepeak", 70_000);

    let { gaps } = await loadInsurance(me, o());
    expect(gaps.map((g) => g.key)).toEqual(
      expect.arrayContaining(["teen_driver", "spouse_health"]),
    );
    await setCovered(me, car.id, "Sam", true, o());
    await setCovered(
      me,
      (await client.insurancePolicy.findFirstOrThrow({ where: { userId: me, kind: "health" } })).id,
      "Robin",
      true,
      o(),
    );
    ({ gaps } = await loadInsurance(me, o()));
    expect(gaps.map((g) => g.key)).not.toContain("teen_driver");
    expect(gaps.map((g) => g.key)).not.toContain("spouse_health");

    const family = await loadFamily(me, o());
    expect(
      family.rows.filter((r) => r.relation !== "spouse").map((r) => [r.name, r.policies.length]),
    ).toEqual([
      ["You", 2],
      ["Sam", 1],
    ]);
    await removePerson(me, "Sam", o());
    expect((await loadFamily(me, o())).people.map((p) => p.name)).toEqual(["Robin"]);
    // And off the policy that listed them.
    expect(
      (await client.insurancePolicy.findUniqueOrThrow({ where: { id: car.id } })).covered,
    ).toEqual([]);
  });

  it("counts both employers' plans for the family, and says in the chat who is covered", async () => {
    const { me, alex } = await couple();
    const mine = await health(me, "Bluepeak", 70_000);
    const theirs = await health(alex, "Acme Corp", 20_000, "employer");
    await setShared(alex, theirs.id, true, o());
    await addPerson(me, { name: "Robin", relation: "spouse", driver: false, age: "41" }, o());
    await addPerson(me, { name: "Sam", relation: "child", driver: false, age: "10" }, o());
    await setCovered(me, mine.id, "Robin", true, o());
    await setCovered(me, mine.id, "Sam", true, o());

    const family = await loadFamily(me, o());
    expect(family.healthPlans.map((r) => r.label)).toEqual([
      "Alex's Acme Corp plan",
      "Your Bluepeak plan",
    ]);
    expect(family.gaps.map((g) => g.key)).toContain("family_health_plan");
    expect(family.partners).toEqual(["Alex"]);

    const { reply } = await sendToJane(me, "is my family covered", o());
    expect(reply.body.split("\n")[0]).toBe("Here's who is covered by what in your household.");
    expect(reply.body).toContain("- Alex: Acme Corp health (Alex's)");
    expect(reply.body).toContain("- Sam: Bluepeak health");
    const tool = JSON.parse((await runChatTool(me, "insurance_household", {}, o())).content);
    expect(tool.healthPlansForTheWholeHousehold).toHaveLength(2);
    // The partner doesn't see the family's plan because it wasn't shared: only theirs shows to you.
    const theirView = await loadFamily(alex, o());
    expect(theirView.policies.map((p) => p.carrier)).toEqual(["Acme Corp"]);
  });
});
