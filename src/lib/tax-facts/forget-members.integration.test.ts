import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { LEGACY_DONE_KEY } from "@/config/tax-facts";
import { forgetEverything, forgetFact, listFacts, recordFact } from "@/lib/memory/facts";
import { clearCorrection, correctFact } from "@/lib/profile";
import { loadTaxHousehold } from "@/lib/tax-facts/load";
import { taxFactParity } from "@/lib/tax-facts/parity";
import { markNeedsRepair } from "@/lib/tax-facts/repair";
import { KEYS_OF_TOLD } from "@/lib/tax-facts/told";

// Forget means gone: after Settings "Forget" or "Delete all memory", no row of the household record
// (tax_facts, tax_household_members) says what was forgotten, hidden or not, and none comes back
// when the record is read or repaired again (what the nightly parity check and every page read do).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-27T18:00:00Z");
const YEAR = 2026;
const OWN_WORD = { in: ["answer", "legacy"] };

describe.runIf(url)("forgetting leaves no row of the household record behind", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const options = {
    get client() {
      return client;
    },
    now: NOW,
  };

  async function person() {
    const user = await client.user.create({
      data: { email: `tax-forget-members-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  const household = (id: string, year = YEAR) => loadTaxHousehold(id, year, { client, now: NOW });
  const memberRows = (id: string) => client.taxHouseholdMember.count({ where: { userId: id } });
  const ownWordRows = (id: string) =>
    // The marker household.legacy_done is bookkeeping, not an answer.
    client.taxFact.count({
      where: { userId: id, origin: OWN_WORD, key: { not: LEGACY_DONE_KEY } },
    });
  const factRows = (id: string, keys: readonly string[]) =>
    client.taxFact.count({ where: { userId: id, key: { in: [...keys] }, origin: OWN_WORD } });
  // Every way the record is read or repaired again, as the pages and the nightly jobs do it.
  async function readAgain(id: string) {
    await household(id);
    await household(id, YEAR + 1);
    await markNeedsRepair(id, { client });
    await household(id);
    await taxFactParity(id, { client, now: NOW });
  }
  async function withChildren() {
    const id = await person();
    await correctFact(id, "has_children", "yes", options);
    await household(id);
    await household(id, YEAR + 1);
    expect(await memberRows(id)).toBeGreaterThan(0);
    return id;
  }
  const forgetByKey = async (id: string, key: string) => {
    const row = (await listFacts(id, { client })).find((f) => f.key === key)!;
    expect(await forgetFact(id, row.id, options)).toBe(true);
  };

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("Forget on the children fact removes the member row", async () => {
    const id = await withChildren();
    await forgetByKey(id, "has_children");
    expect(await memberRows(id)).toBe(0);
    expect(await factRows(id, KEYS_OF_TOLD.has_children)).toBe(0);
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
    expect(await factRows(id, KEYS_OF_TOLD.has_children)).toBe(0);
  });

  it("the profile page's Forget on the children fact removes the member row", async () => {
    const id = await withChildren();
    await clearCorrection(id, "has_children", options);
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
  });

  it("Delete all memory removes the member row", async () => {
    const id = await withChildren();
    await forgetEverything(id, { client });
    expect(await memberRows(id)).toBe(0);
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
    expect(await ownWordRows(id)).toBe(0);
  });

  it("Forget, then Delete all memory, leaves nothing", async () => {
    const id = await withChildren();
    await forgetByKey(id, "has_children");
    await forgetEverything(id, { client });
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
    expect(await ownWordRows(id)).toBe(0);
  });

  // A child taken off the family form is marked removed, never deleted, while memory is kept.
  async function withRemovedChild() {
    const id = await person();
    await client.taxProfile.create({
      data: {
        userId: id,
        childrenUnder17: 1,
        answered: ["dependants"],
        familyChildren: [{ ageAtYearEnd: 9, hasSsn: true, monthsLivedWithYou: 12 }],
      },
    });
    await household(id);
    await client.taxProfile.updateMany({
      where: { userId: id },
      data: { childrenUnder17: 0, answered: [], familyChildren: [] },
    });
    await markNeedsRepair(id, { client });
    await household(id);
    const rows = await client.taxHouseholdMember.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].removedAt).not.toBeNull();
    return id;
  }

  it("a child removed on the family form stays marked removed while memory is kept", async () => {
    const id = await withRemovedChild();
    await correctFact(id, "home_state", "CA", options);
    await forgetByKey(id, "home_state");
    expect(await memberRows(id)).toBe(1);
  });

  it("Forget on the children fact also removes a child taken off the family form earlier", async () => {
    const id = await withRemovedChild();
    await correctFact(id, "has_children", "yes", options);
    await household(id);
    await forgetByKey(id, "has_children");
    expect(await memberRows(id)).toBe(0);
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
  });

  it("Delete all memory removes a child taken off the family form earlier", async () => {
    const id = await withRemovedChild();
    await forgetEverything(id, { client });
    expect(await memberRows(id)).toBe(0);
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
  });

  it("Forget on the children fact keeps the children the tax profile itself still gives", async () => {
    const id = await person();
    await client.taxProfile.create({
      data: { userId: id, childrenUnder17: 2, answered: ["dependants"] },
    });
    await correctFact(id, "has_children", "yes", options);
    await household(id);
    await forgetByKey(id, "has_children");
    await readAgain(id);
    const keys = (await client.taxHouseholdMember.findMany({ where: { userId: id } })).map((m) => [
      m.memberKey,
      m.removedAt === null,
    ]);
    expect(keys).toContainEqual(["child:count-1", true]);
    expect(keys).toContainEqual(["child:count-2", true]);
  });

  // Every fact a person can tell that mirrors into the record: tell it, forget it, no row says it.
  const TOLD: [string, string][] = [
    ["filing_status", "single"],
    ["claimed_as_dependent", "no"],
    ["tax_residency", "other_visa"],
    ["enrollment", "undergrad"],
    ["home_state", "CA"],
    ["has_children", "yes"],
  ];
  it.each(TOLD)("tell %s, forget it: no row records it", async (key, value) => {
    const id = await person();
    await correctFact(id, key, value, options);
    await household(id);
    await household(id, YEAR + 1);
    expect(await factRows(id, KEYS_OF_TOLD[key])).toBeGreaterThan(0);
    await forgetByKey(id, key);
    await readAgain(id);
    expect(await factRows(id, KEYS_OF_TOLD[key])).toBe(0);
    expect(await memberRows(id)).toBe(0);
  });

  it("tell age, forget it: no row records it", async () => {
    const id = await person();
    await recordFact(id, { key: "age", value: 30, label: "Age 30", source: "answer" }, { client });
    await household(id);
    expect(await factRows(id, KEYS_OF_TOLD.age)).toBeGreaterThan(0);
    await forgetByKey(id, "age");
    await readAgain(id);
    expect(await factRows(id, KEYS_OF_TOLD.age)).toBe(0);
  });

  it("Delete all memory with every fact told leaves no row", async () => {
    const id = await person();
    for (const [key, value] of TOLD) await correctFact(id, key, value, options);
    await recordFact(id, { key: "age", value: 30, label: "Age 30", source: "answer" }, { client });
    await household(id);
    await household(id, YEAR + 1);
    await forgetEverything(id, { client });
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
    expect(await ownWordRows(id)).toBe(0);
  });
});
