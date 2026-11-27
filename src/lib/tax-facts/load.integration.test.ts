import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOLD_FROM_RESIDENCY } from "@/config/tax-facts";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The real transaction helper, except where a test makes the copy fail.
vi.mock("@/lib/db-scoped", async (original) => {
  const real = await original<typeof import("@/lib/db-scoped")>();
  return { ...real, personTransaction: vi.fn(real.personTransaction) };
});

import { logAudit } from "@/lib/audit";
import { personTransaction } from "@/lib/db-scoped";
import { recordFact } from "@/lib/memory/facts";
import { loadFiling } from "@/lib/filing-status";
import { loadTaxHousehold } from "@/lib/tax-facts/load";
import { recordTaxFact, TaxFactError } from "@/lib/tax-facts/write";
import { loadToldResidency } from "@/lib/tax-residency";
import { fact } from "@/planning/tax-engine/facts";

// Step T9 against a real, migrated Postgres: a person's older answers are copied into the household
// record once, read back through the merge rule, scoped to them, and written with their audit.

const url = process.env.TEST_DATABASE_URL;
// 10am in Los Angeles, Nov 27.
const NOW = new Date("2026-11-27T18:00:00Z");
const YEAR = 2026;

describe.runIf(url)("the household fact record against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(over: { id?: string; timezone?: string } = {}) {
    const user = await client.user.create({
      data: { email: `tax-facts-${crypto.randomUUID()}@example.com`, ...over },
    });
    created.push(user.id);
    return user.id;
  }
  const told = (
    userId: string,
    key: string,
    value: string | number | boolean,
    createdAt = "2026-09-09T19:00:00Z",
  ) =>
    client.janePreference.create({
      data: {
        userId,
        kind: "fact",
        key: `profile:${key}`,
        value: { value },
        label: key,
        createdAt: new Date(createdAt),
      },
    });
  const rowsOf = (userId: string) =>
    client.taxFact.findMany({ where: { userId }, orderBy: [{ key: "asc" }, { id: "asc" }] });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(() => vi.mocked(logAudit).mockClear());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("copies every older store in once, and a second load changes nothing", async () => {
    const id = await person();
    await client.taxProfile.create({
      data: {
        userId: id,
        filingStatus: "married_joint",
        state: "CA",
        childrenUnder17: 2,
        otherDependants: 1,
        familyChildren: [{ ageAtYearEnd: 8, hasSsn: true, monthsLivedWithYou: 12 }],
        spouseWagesCents: 6_000_000,
        studentYearsBefore: 1,
        studentHalfTime: true,
        answered: ["filingStatus", "state", "dependants"],
      },
    });
    await client.investorProfile.create({
      data: { userId: id, age: 30, ageOn: new Date("2026-01-15T00:00:00Z") },
    });
    await told(id, "claimed_as_dependent", "no");
    await told(id, "tax_residency", "citizen");
    await told(id, "enrollment", "grad");
    await told(id, "home_state", "CA");

    const first = await loadTaxHousehold(id, YEAR, { client, now: NOW });
    const v = <T>(key: Parameters<typeof fact>[1], member?: string) => fact<T>(first, key, member);
    expect(v("filing.status")).toMatchObject({ value: "married_joint", origin: "answer" });
    expect(v("filing.claimed_as_dependent")).toMatchObject({ value: "no", origin: "answer" });
    expect(v("residency.status")).toMatchObject({
      value: "citizen_or_green_card",
      origin: "answer",
      asOf: "2026-09-09",
    });
    expect(v("home.state")).toMatchObject({ value: "CA", origin: "answer" });
    expect(v("home.state").conflicts).toEqual([]);
    expect(v("person.half_time")).toMatchObject({ value: true, origin: "answer" });
    expect(v("person.degree_program").value).toBe("grad");
    expect(v("person.postsecondary_years_before").value).toBe(1);
    expect(v("spouse.earned_income").value).toBe(6_000_000);
    expect(v("person.birth_date")).toMatchObject({ status: "inferred" });
    expect(v("household.dependants_stated").value).toBe(true);
    expect(v("member.birth_date", "child:legacy-1").value).toBe("2018");
    expect(first.members.map((m) => m.key)).toEqual([
      "child:legacy-1",
      "child:legacy-2",
      "relative:legacy-1",
    ]);

    const stored = await rowsOf(id);
    expect(stored.find((r) => r.key === "household.legacy_done")).toMatchObject({
      taxYear: YEAR,
      origin: "legacy",
    });
    const members = await client.taxHouseholdMember.count({ where: { userId: id } });

    const second = await loadTaxHousehold(id, YEAR, { client, now: NOW });
    expect((await rowsOf(id)).map((r) => r.id)).toEqual(stored.map((r) => r.id));
    expect(await client.taxHouseholdMember.count({ where: { userId: id } })).toBe(members);
    expect([...second.facts.keys()].sort()).toEqual([...first.facts.keys()].sort());
    expect(second.members).toEqual(first.members);
  });

  it("settles two disagreeing filing answers as the older store's rule does, and keeps both", async () => {
    const id = await person();
    // The profile said married filing jointly in September; the card said single in October.
    await client.taxProfile.create({
      data: { userId: id, filingStatus: "married_joint", answered: ["filingStatus"] },
    });
    await client.auditLog.create({
      data: {
        actorType: "user",
        actorId: id,
        event: "tax_profile_changed",
        targetType: "user",
        targetId: id,
        metadata: { fields: "filingStatus", via: "page" },
        createdAt: new Date("2026-09-01T12:00:00Z"),
      },
    });
    await told(id, "filing_status", "single", "2026-10-01T12:00:00Z");
    try {
      const read = (await loadFiling(id, { client })).read;
      const h = await loadTaxHousehold(id, YEAR, { client, now: NOW });
      const f = fact<string>(h, "filing.status");
      // The same answer as the one read path, never a third reading.
      expect(f.value).toBe(read.status);
      expect(f.value).toBe("single");
      expect(f.conflicts).toEqual([
        expect.objectContaining({ value: "married_joint", origin: "legacy" }),
      ]);
    } finally {
      await client.auditLog.deleteMany({ where: { targetId: id } });
    }
  });

  it("gives no filing status to a person whose only filing status is a guess", async () => {
    const id = await person();
    const h = await loadTaxHousehold(id, YEAR, { client, now: NOW });
    expect(fact(h, "filing.status").status).toBe("unknown");
    expect(await rowsOf(id)).toHaveLength(1); // the marker alone
  });

  it("reads residency as the one residency read does", async () => {
    for (const said of ["citizen", "student_visa", "other_visa", "unsure"]) {
      const id = await person();
      await told(id, "tax_residency", said);
      const h = await loadTaxHousehold(id, YEAR, { client, now: NOW });
      const value = fact<string>(h, "residency.status").value!;
      expect(TOLD_FROM_RESIDENCY[value]).toBe(said);
      expect(TOLD_FROM_RESIDENCY[value] === "citizen").toBe(
        (await loadToldResidency(id, { client })).allowed,
      );
    }
    const none = await loadTaxHousehold(await person(), YEAR, { client, now: NOW });
    expect(fact(none, "residency.status").status).toBe("unknown");
  });

  it("never shows another person's rows, and keeps each year apart", async () => {
    const mine = await person();
    const theirs = await person();
    await told(theirs, "tax_residency", "citizen");
    await loadTaxHousehold(theirs, YEAR, { client, now: NOW });
    await recordTaxFact(
      theirs,
      { key: "prior.agi", value: 9_000_000, taxYear: YEAR, origin: "answer" },
      { client, now: NOW },
    );
    const h = await loadTaxHousehold(mine, YEAR, { client, now: NOW });
    expect(fact(h, "residency.status").status).toBe("unknown");
    expect(fact(h, "prior.agi").status).toBe("unknown");
    expect((await rowsOf(mine)).every((r) => r.userId === mine)).toBe(true);
    // Another year is a household of its own, copied in on its own first read.
    const next = await loadTaxHousehold(theirs, YEAR + 1, { client, now: NOW });
    expect(fact(next, "prior.agi").status).toBe("unknown");
    expect(fact(next, "residency.status").value).toBe("citizen_or_green_card");
  });

  it("writes a new answer over the old, keeping the old as history, and leaves a repeat alone", async () => {
    const id = await person();
    const rec = (value: string, now = NOW) =>
      recordTaxFact(
        id,
        { key: "filing.status", value, taxYear: YEAR, origin: "answer" },
        { client, now },
      );
    expect(await rec("single")).toBe("recorded");
    expect(await rec("single")).toBe("unchanged");
    expect(await rec("married_joint", new Date("2026-11-28T18:00:00Z"))).toBe("recorded");
    const rows = await client.taxFact.findMany({ where: { userId: id, key: "filing.status" } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.supersededAt === null).map((r) => r.value)).toEqual([
      { v: "married_joint" },
    ]);
    const h = await loadTaxHousehold(id, YEAR, { client, now: NOW });
    expect(fact(h, "filing.status").value).toBe("married_joint");
  });

  it("holds one current row per fact and origin when two writes arrive at once", async () => {
    const id = await person();
    const write = (value: string) =>
      recordTaxFact(
        id,
        { key: "home.state", value, taxYear: YEAR, origin: "answer" },
        { client, now: NOW },
      );
    await Promise.all([write("CA"), write("NY"), write("TX")]);
    const current = await client.taxFact.findMany({
      where: { userId: id, key: "home.state", supersededAt: null },
    });
    expect(current).toHaveLength(1);
  });

  it("refuses a value that does not fit the fact", async () => {
    const id = await person();
    const bad = (key: "filing.status" | "member.gross_income", value: string | number) =>
      recordTaxFact(id, { key, value, taxYear: YEAR, origin: "answer" }, { client, now: NOW });
    await expect(bad("filing.status", "head_of_state")).rejects.toThrow(TaxFactError);
    await expect(bad("member.gross_income", -5)).rejects.toThrow(TaxFactError);
    await expect(bad("member.gross_income", 1.5)).rejects.toThrow(TaxFactError);
    expect(await rowsOf(id)).toEqual([]);
  });

  it("audits a sensitive write by its key and origin, never its value", async () => {
    const id = await person();
    await recordTaxFact(
      id,
      { key: "prior.agi", value: 12_345_678, taxYear: YEAR, origin: "document" },
      { client, now: NOW },
    );
    await recordTaxFact(
      id,
      { key: "home.state", value: "CA", taxYear: YEAR, origin: "answer" },
      { client, now: NOW },
    );
    expect(logAudit).toHaveBeenCalledTimes(1);
    const [actor, event, target, metadata] = vi.mocked(logAudit).mock.calls[0];
    expect(actor).toEqual({ type: "user", id });
    expect(event).toBe("tax_fact_recorded");
    expect(target).toEqual({ type: "user", id });
    expect(metadata).toEqual({ key: "prior.agi", origin: "document" });
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain("12345678");
    // The same value again is not a new event.
    await recordTaxFact(
      id,
      { key: "prior.agi", value: 12_345_678, taxYear: YEAR, origin: "document" },
      { client, now: NOW },
    );
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it("audits the sensitive facts copied in by read-repair, by key", async () => {
    const id = await person();
    await told(id, "tax_residency", "student_visa");
    await loadTaxHousehold(id, YEAR, { client, now: NOW });
    expect(vi.mocked(logAudit).mock.calls.map((c) => c[3])).toEqual([
      { key: "residency.status", origin: "answer" },
    ]);
  });

  it("dates a fact on the person's own day, either side of UTC midnight", async () => {
    const id = await person({ timezone: "America/Los_Angeles" });
    // 3pm and 7pm on Nov 27 in Los Angeles: the second is already Nov 28 in UTC.
    const threePm = new Date("2026-11-27T23:00:00Z");
    const sevenPm = new Date("2026-11-28T03:00:00Z");
    await recordTaxFact(
      id,
      { key: "residency.status", value: "student_visa", taxYear: YEAR, origin: "answer" },
      { client, now: threePm },
    );
    await recordTaxFact(
      id,
      { key: "home.ca_months", value: 12, taxYear: YEAR, origin: "answer" },
      { client, now: sevenPm },
    );
    const h = await loadTaxHousehold(id, YEAR, { client, now: sevenPm });
    expect(h.today).toBe("2026-11-27");
    expect(fact(h, "residency.status").asOf).toBe("2026-11-27");
    expect(fact(h, "home.ca_months").asOf).toBe("2026-11-27");
    expect(fact(h, "household.legacy_done").asOf).toBe("2026-11-27");
    // And a day later for the person, the same instant's UTC date has caught up.
    const morning = await loadTaxHousehold(id, YEAR + 1, {
      client,
      now: new Date("2026-11-28T18:00:00Z"),
    });
    expect(morning.today).toBe("2026-11-28");
  });

  it("dates an age on the day Jane last heard it, not the day the card first saved one", async () => {
    const id = await person();
    // The card saved an age in 2024 and the person changed it since (the preference keeps its first
    // day); memory has the newer answer confirmed on June 1, 2026.
    await told(id, "age", 22, "2024-03-01T19:00:00Z");
    await recordFact(id, { key: "age", value: 22, label: "Age 22", source: "answer" }, { client });
    await client.userFact.updateMany({
      where: { userId: id, key: "age" },
      data: { lastConfirmed: new Date("2026-06-01T19:00:00Z") },
    });
    const h = await loadTaxHousehold(id, YEAR, { client, now: NOW });
    // 22 on June 1, 2026: born in 2003 or 2004.
    expect(fact(h, "person.birth_date")).toMatchObject({
      value: "2003/2004",
      asOf: "2026-06-01",
      status: "inferred",
    });
  });

  it("keeps the members already stored when the copy of the older answers cannot be written", async () => {
    const id = await person();
    await client.taxHouseholdMember.create({
      data: {
        userId: id,
        taxYear: YEAR,
        memberKey: "relative:added-1",
        label: "Aunt Rosa",
        relationship: "parent",
      },
    });
    await told(id, "has_children", true);
    vi.mocked(personTransaction).mockRejectedValueOnce(new Error("the database blinked"));
    const h = await loadTaxHousehold(id, YEAR, { client, now: NOW });
    expect(h.members.map((m) => m.key).sort()).toEqual(["child:legacy-1", "relative:added-1"]);
    // Nothing was stored, so the next read tries again and stores it.
    expect(await rowsOf(id)).toEqual([]);
    const again = await loadTaxHousehold(id, YEAR, { client, now: NOW });
    expect(again.members.map((m) => m.key).sort()).toEqual(["child:legacy-1", "relative:added-1"]);
    expect((await rowsOf(id)).length).toBeGreaterThan(0);
  });

  it("audits a sensitive write before making it, so no written fact lacks its entry", async () => {
    const id = await person();
    vi.mocked(personTransaction).mockRejectedValueOnce(new Error("the database blinked"));
    await expect(
      recordTaxFact(
        id,
        { key: "prior.agi", value: 5_000_000, taxYear: YEAR, origin: "answer" },
        { client, now: NOW },
      ),
    ).rejects.toThrow("blinked");
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAudit).mock.calls[0][3]).toEqual({ key: "prior.agi", origin: "answer" });
    expect(await rowsOf(id)).toEqual([]);
  });

  it("stores nothing for a sample person or a trial person, and reads a sample person as a citizen", async () => {
    const sample = await person();
    await client.plaidItem.create({
      data: {
        userId: sample,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "x",
        institutionName: "Demo",
      },
    });
    await told(sample, "home_state", "WA");
    const h = await loadTaxHousehold(sample, YEAR, { client, now: NOW });
    expect(fact(h, "residency.status").value).toBe("citizen_or_green_card");
    expect(fact(h, "home.state").value).toBe("WA");
    expect(await rowsOf(sample)).toEqual([]);

    const trialId = `trial_${crypto.randomUUID()}`;
    await person({ id: trialId });
    await told(trialId, "home_state", "OR");
    const t = await loadTaxHousehold(trialId, YEAR, { client, now: NOW });
    expect(fact(t, "home.state").value).toBe("OR");
    expect(await rowsOf(trialId)).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
