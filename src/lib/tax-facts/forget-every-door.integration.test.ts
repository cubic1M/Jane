import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const session = vi.hoisted(() => ({ id: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.id })) }));
vi.mock("@/lib/rescan-after-answer", () => ({ rescanAfterAnswer: vi.fn(async () => undefined) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { forgetPreference } from "@/app/settings/memory-actions";
import { forgetAllMemory, forgetMemoryFact } from "@/app/settings/memory/actions";
import { forgetProfileCorrection } from "@/app/profile/actions";
import { LEGACY_DONE_KEY } from "@/config/tax-facts";
import { deletePreference } from "@/lib/jane-agent/preferences";
import { listFacts } from "@/lib/memory/facts";
import { correctFact } from "@/lib/profile";
import { forgetToldRecord } from "@/lib/tax-facts/through";
import { loadTaxHousehold } from "@/lib/tax-facts/load";
import { taxFactParity } from "@/lib/tax-facts/parity";
import { markNeedsRepair } from "@/lib/tax-facts/repair";
import { KEYS_OF_TOLD } from "@/lib/tax-facts/told";

// Forget means gone, whichever door the person goes through: after it, no row of the household
// record (tax_facts with the person's own words, tax_household_members) says what was forgotten, and
// none comes back when the record is read or repaired again. Each door is driven through its own
// function (the server action), not the helper under it. Found by the walker: Settings > "What Jane
// knows about you" > Forget cleared what Jane knows and the tax profile but left the record.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date();
const YEAR = 2026;
const OWN_WORD = { in: ["answer", "legacy"] };

// What a person can tell Jane that the record keeps: the told fact's name, what they say.
const TOLD: [string, string][] = [
  ["has_children", "yes"],
  ["filing_status", "married_joint"],
  ["age", "30"],
  ["home_state", "CA"],
  ["tax_residency", "other_visa"],
  ["enrollment", "undergrad"],
  ["claimed_as_dependent", "no"],
];

describe.runIf(url)("every door that forgets a told fact clears the household record", () => {
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
      data: { email: `tax-forget-door-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    session.id = user.id;
    return user.id;
  }
  const household = (id: string, year = YEAR) => loadTaxHousehold(id, year, { client, now: NOW });
  const memberRows = (id: string) => client.taxHouseholdMember.count({ where: { userId: id } });
  const factRows = (id: string, keys: readonly string[]) =>
    client.taxFact.count({ where: { userId: id, key: { in: [...keys] }, origin: OWN_WORD } });
  const ownWordRows = (id: string) =>
    client.taxFact.count({
      where: { userId: id, origin: OWN_WORD, key: { not: LEGACY_DONE_KEY } },
    });
  async function readAgain(id: string) {
    await household(id);
    await household(id, YEAR + 1);
    await markNeedsRepair(id, { client });
    await household(id);
    await taxFactParity(id, { client, now: NOW });
  }
  async function tell(id: string, key: string, value: string) {
    await correctFact(id, key, value, options);
    await household(id);
    await household(id, YEAR + 1);
    expect(await factRows(id, KEYS_OF_TOLD[key])).toBeGreaterThan(0);
  }
  const preferenceId = async (id: string, key: string) =>
    (await client.janePreference.findFirstOrThrow({ where: { userId: id, key: `profile:${key}` } }))
      .id;
  const factId = async (id: string, key: string) =>
    (await listFacts(id, { client })).find((f) => f.key === key)!.id;
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };
  async function expectGone(id: string, key: string) {
    await readAgain(id);
    expect(await factRows(id, KEYS_OF_TOLD[key])).toBe(0);
    if (key === "has_children") expect(await memberRows(id)).toBe(0);
  }

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  // The walker's own case first: children at home, filing status and age, in one person.
  it("Settings > Forget (forgetPreference) on children, filing status and age leaves no row", async () => {
    const id = await person();
    await tell(id, "has_children", "yes");
    await tell(id, "filing_status", "married_joint");
    await tell(id, "age", "30");
    expect(await memberRows(id)).toBeGreaterThan(0);
    for (const key of ["has_children", "filing_status", "age"]) {
      await forgetPreference(form({ preferenceId: await preferenceId(id, key) }));
    }
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
    expect(await ownWordRows(id)).toBe(0);
  });

  it.each(TOLD)("Settings > Forget (forgetPreference) on %s leaves no row", async (key, value) => {
    const id = await person();
    await tell(id, key, value);
    await forgetPreference(form({ preferenceId: await preferenceId(id, key) }));
    await expectGone(id, key);
  });

  it.each(TOLD)(
    "Settings > Memory > Forget (forgetMemoryFact) on %s leaves no row",
    async (key, value) => {
      const id = await person();
      await tell(id, key, value);
      await forgetMemoryFact(form({ factId: await factId(id, key) }));
      await expectGone(id, key);
    },
  );

  it.each(TOLD)(
    "the profile page's Forget (forgetProfileCorrection) on %s leaves no row",
    async (key, value) => {
      const id = await person();
      await tell(id, key, value);
      await forgetProfileCorrection(form({ key }));
      await expectGone(id, key);
    },
  );

  it("Settings > Memory > Delete all memory (forgetAllMemory) leaves no row", async () => {
    const id = await person();
    for (const [key, value] of TOLD) await tell(id, key, value);
    await forgetAllMemory(form({ confirm: "yes" }));
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
    expect(await ownWordRows(id)).toBe(0);
  });

  it("deletePreference itself (the one shared door) clears the record, for any caller", async () => {
    const id = await person();
    await tell(id, "has_children", "yes");
    expect(await deletePreference(id, await preferenceId(id, "has_children"), { client })).toBe(
      true,
    );
    await expectGone(id, "has_children");
  });

  it("a caller that cleans up as well repeats it harmlessly", async () => {
    const id = await person();
    await tell(id, "filing_status", "single");
    await tell(id, "has_children", "yes");
    await forgetPreference(form({ preferenceId: await preferenceId(id, "has_children") }));
    await forgetToldRecord(id, "has_children", options);
    await forgetToldRecord(id, "has_children", options);
    await forgetProfileCorrection(form({ key: "has_children" }));
    await readAgain(id);
    expect(await memberRows(id)).toBe(0);
    // What they did not forget is still there.
    expect(await factRows(id, KEYS_OF_TOLD.filing_status)).toBeGreaterThan(0);
  });

  it("forgetting a preference that is not a tax answer leaves the record alone", async () => {
    const id = await person();
    await tell(id, "filing_status", "single");
    await tell(id, "home_state", "CA");
    await forgetPreference(form({ preferenceId: await preferenceId(id, "home_state") }));
    await readAgain(id);
    expect(await factRows(id, KEYS_OF_TOLD.home_state)).toBe(0);
    expect(await factRows(id, KEYS_OF_TOLD.filing_status)).toBeGreaterThan(0);
  });

  it("Settings > Forget keeps the children the tax profile form itself gives", async () => {
    const id = await person();
    await client.taxProfile.create({
      data: { userId: id, childrenUnder17: 2, answered: ["dependants"] },
    });
    await tell(id, "has_children", "yes");
    await forgetPreference(form({ preferenceId: await preferenceId(id, "has_children") }));
    await readAgain(id);
    const keys = (await client.taxHouseholdMember.findMany({ where: { userId: id } })).map(
      (m) => m.memberKey,
    );
    expect(keys).toContain("child:count-1");
    expect(keys).toContain("child:count-2");
  });
});
