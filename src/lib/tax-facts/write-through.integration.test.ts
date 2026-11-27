import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The real transaction helper, except where a test makes the copy fail.
vi.mock("@/lib/db-scoped", async (original) => {
  const real = await original<typeof import("@/lib/db-scoped")>();
  return { ...real, personTransaction: vi.fn(real.personTransaction) };
});

import { saveFamilyDetails } from "@/lib/family-taxes";
import { familyFrom } from "@/app/taxes/profile/answers";
import { forgetEverything, forgetFact, listFacts, recordFact } from "@/lib/memory/facts";
import { clearCorrection, correctFact } from "@/lib/profile";
import { loadTaxHousehold, taxHouseholdYears } from "@/lib/tax-facts/load";
import { personTransaction } from "@/lib/db-scoped";
import { saveTaxAnswers } from "@/lib/tax-profile";
import { fact } from "@/planning/tax-engine/facts";

// Step T9, part 3: every writer of an older store brings the household record in line with it, none
// writes the older store less than before, and every way of taking an answer back removes it from
// the record for good.

const url = process.env.TEST_DATABASE_URL;
// 10am in Los Angeles on Nov 27: the tax year being worked on is 2026.
const NOW = new Date("2026-11-27T18:00:00Z");
const YEAR = 2026;

describe.runIf(url)("the household record follows the older stores", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `tax-through-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  const household = (id: string, year = YEAR) => loadTaxHousehold(id, year, { client, now: NOW });
  const told = async (id: string, key: string) =>
    (
      await client.janePreference.findFirst({
        where: { userId: id, kind: "fact", key: `profile:${key}` },
      })
    )?.value;
  const rows = (id: string, key: string) => client.taxFact.count({ where: { userId: id, key } });
  const options = {
    get client() {
      return client;
    },
    now: NOW,
  };

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("records a told fact beside the preference the card saves", async () => {
    const id = await person();
    await household(id);
    await correctFact(id, "tax_residency", "student_visa", options);
    await correctFact(id, "claimed_as_dependent", "no", options);
    await correctFact(id, "enrollment", "undergrad", options);
    await correctFact(id, "home_state", "CA", options);
    expect(await told(id, "tax_residency")).toEqual({ value: "student_visa" });
    const h = await household(id);
    expect(fact(h, "residency.status")).toMatchObject({
      value: "student_visa",
      origin: "answer",
      asOf: "2026-11-27",
    });
    expect(fact(h, "filing.claimed_as_dependent").value).toBe("no");
    expect(fact(h, "person.half_time").value).toBe(true);
    expect(fact(h, "person.degree_program").value).toBe("undergrad");
    expect(fact(h, "home.state").value).toBe("CA");
  });

  it("follows a changed answer, keeping the old one as history", async () => {
    const id = await person();
    await correctFact(id, "tax_residency", "unsure", options);
    await correctFact(id, "tax_residency", "citizen", {
      client,
      now: new Date("2026-11-28T18:00:00Z"),
    });
    const all = await client.taxFact.findMany({ where: { userId: id, key: "residency.status" } });
    expect(all.map((r) => [r.value, r.supersededAt !== null])).toEqual(
      expect.arrayContaining([
        [{ v: "unsure" }, true],
        [{ v: "citizen_or_green_card" }, false],
      ]),
    );
  });

  it("keeps how they file the same on the card, the tax profile and the record", async () => {
    const id = await person();
    await correctFact(id, "filing_status", "single", options);
    expect(fact(await household(id), "filing.status").value).toBe("single");
    await saveTaxAnswers(id, [{ field: "filingStatus", value: "married_joint" }], {
      client,
      now: new Date("2026-11-27T19:00:00Z"),
      via: "page",
    });
    expect(await told(id, "filing_status")).toMatchObject({ value: "married_joint" });
    expect(fact(await household(id), "filing.status").value).toBe("married_joint");
  });

  describe("taking an answer back removes it from the record for good", () => {
    // Current, superseded and copied rows, in two years; then `forget` takes it back.
    async function withAnswerEverywhere(key: string, value: string, fact_: string) {
      const id = await person();
      await correctFact(id, key, value, options);
      await correctFact(id, key, fact_, { client, now: new Date("2026-11-27T19:00:00Z") });
      await household(id, YEAR + 1);
      return id;
    }

    it("Settings 'Forget' on one fact", async () => {
      const id = await withAnswerEverywhere("tax_residency", "unsure", "student_visa");
      expect(await rows(id, "residency.status")).toBeGreaterThan(1);
      const row = (await listFacts(id, { client })).find((f) => f.key === "tax_residency")!;
      expect(await forgetFact(id, row.id, options)).toBe(true);
      expect(await rows(id, "residency.status")).toBe(0);
      expect(fact(await household(id), "residency.status").status).toBe("unknown");
      expect(fact(await household(id, YEAR + 1), "residency.status").status).toBe("unknown");
      expect(await rows(id, "residency.status")).toBe(0);
    });

    it("Settings 'Delete all memory'", async () => {
      const id = await withAnswerEverywhere("tax_residency", "unsure", "other_visa");
      await correctFact(id, "home_state", "CA", options);
      await recordFact(
        id,
        { key: "age", value: 30, label: "Age 30", source: "answer" },
        { client },
      );
      await household(id);
      expect(await rows(id, "home.state")).toBeGreaterThan(0);
      await forgetEverything(id, { client });
      for (const key of ["residency.status", "home.state", "person.birth_date"])
        expect(await rows(id, key), key).toBe(0);
      const h = await household(id);
      expect(fact(h, "residency.status").status).toBe("unknown");
      expect(fact(h, "home.state").status).toBe("unknown");
    });

    it("the profile page's 'Forget' on a corrected fact, and again when it is already gone", async () => {
      const id = await withAnswerEverywhere("tax_residency", "other_visa", "unsure");
      expect(await clearCorrection(id, "tax_residency", options)).toBe(true);
      expect(await rows(id, "residency.status")).toBe(0);
      // The record had it back by some other way: taking it back again finishes the job.
      await household(id);
      expect(await clearCorrection(id, "tax_residency", options)).toBe(false);
      expect(await rows(id, "residency.status")).toBe(0);
      expect(fact(await household(id), "residency.status").status).toBe("unknown");
    });

    it("how they file, including the older answer kept beside it", async () => {
      const id = await person();
      await correctFact(id, "filing_status", "single", options);
      await saveTaxAnswers(id, [{ field: "filingStatus", value: "married_joint" }], {
        client,
        now: new Date("2026-11-27T19:00:00Z"),
        via: "page",
      });
      await household(id, YEAR + 1);
      await clearCorrection(id, "filing_status", options);
      expect(await rows(id, "filing.status")).toBe(0);
      expect(fact(await household(id), "filing.status").status).toBe("unknown");
    });
  });

  it("records the state and the household the tax profile's form saves, without renumbering", async () => {
    const id = await person();
    await saveTaxAnswers(
      id,
      [
        { field: "state", value: "NY" },
        { field: "dependants", childrenUnder17: 2, otherDependants: 1 },
      ],
      { ...options, via: "page" },
    );
    let h = await household(id);
    expect(fact(h, "home.state")).toMatchObject({ value: "NY", origin: "answer" });
    expect(fact(h, "household.dependants_stated").value).toBe(true);
    expect(h.members.map((m) => m.key)).toEqual([
      "child:count-1",
      "child:count-2",
      "relative:count-1",
    ]);
    await saveTaxAnswers(id, [{ field: "dependants", childrenUnder17: 1, otherDependants: 0 }], {
      ...options,
      via: "chat",
    });
    h = await household(id);
    expect(h.members.map((m) => m.key)).toEqual(["child:count-1"]);
    expect(await client.taxHouseholdMember.count({ where: { userId: id } })).toBe(3);
  });

  it("gives each child on the family form an id, and a removed child never hands facts on", async () => {
    const id = await person();
    const kid = (age: number) => ({ ageAtYearEnd: age, hasSsn: true, monthsLivedWithYou: 12 });
    const save = (children: unknown[]) =>
      saveFamilyDetails(
        id,
        {
          children: children as never,
          spouseWagesCents: null,
          paysOverHalfHome: null,
          student: null,
        },
        { ...options, via: "page" },
      );
    const stored = async () =>
      (await client.taxProfile.findUniqueOrThrow({ where: { userId: id } })).familyChildren as {
        id: string;
        ageAtYearEnd: number;
      }[];
    await save([kid(9), kid(4)]);
    const [a, b] = await stored();
    expect(a.id).toMatch(/^c_[0-9a-f]{12}$/);
    let h = await household(id);
    expect(fact(h, "member.birth_date", `child:${a.id}`).value).toBe("2017");
    expect(fact(h, "member.birth_date", `child:${b.id}`).value).toBe("2022");
    // The form is shown with ids and sends them back; the first child's row is emptied.
    const form = new FormData();
    form.set("childAge0", "");
    form.set("childId0", a.id);
    form.set("childAge1", "4");
    form.set("childId1", b.id);
    form.set("childId2", "c_ffffffffffff");
    await save(familyFrom(form).children);
    expect((await stored()).map((c) => c.id)).toEqual([b.id]);
    h = await household(id);
    expect(h.members.map((m) => m.key)).toEqual([`child:${b.id}`]);
    expect(fact(h, "member.birth_date", `child:${b.id}`).value).toBe("2022");
    expect(fact(h, "member.birth_date", `child:${a.id}`).status).toBe("unknown");
    // An id the form was never shown is not taken: the child gets its own.
    await save([{ ...kid(2), id: "c_aaaaaaaaaaaa" }]);
    expect((await stored())[0].id).not.toBe("c_aaaaaaaaaaaa");
  });

  it("records the family details, and 'I have children' as one child", async () => {
    const id = await person();
    await saveFamilyDetails(
      id,
      {
        children: [{ ageAtYearEnd: 6, hasSsn: true, monthsLivedWithYou: 12 }],
        spouseWagesCents: 4_000_000,
        paysOverHalfHome: true,
        student: { yearsOfCollegeBefore: 2, halfTime: true },
      },
      { ...options, via: "page" },
    );
    let h = await household(id);
    expect(fact(h, "spouse.earned_income").value).toBe(4_000_000);
    expect(fact(h, "person.postsecondary_years_before").value).toBe(2);
    expect(fact(h, "person.half_time").value).toBe(true);
    await saveFamilyDetails(
      id,
      { children: [], spouseWagesCents: null, paysOverHalfHome: null, student: null },
      { ...options, via: "page" },
    );
    h = await household(id);
    expect(fact(h, "spouse.earned_income").status).toBe("unknown");
    expect(fact(h, "person.half_time").status).toBe("unknown");
    const other = await person();
    await correctFact(other, "has_children", "yes", options);
    expect((await household(other)).members.map((m) => m.key)).toEqual(["child:count-1"]);
  });

  it("copies again, with nothing lost, when the record could not be written", async () => {
    const id = await person();
    await household(id);
    vi.mocked(personTransaction).mockRejectedValueOnce(new Error("the database blinked"));
    // The answer is not undone and the call does not fail: the older store has it.
    await expect(correctFact(id, "tax_residency", "citizen", options)).resolves.toBeUndefined();
    expect(await told(id, "tax_residency")).toEqual({ value: "citizen" });
    // The record is marked to be copied again, so the next read has the answer.
    expect(fact(await household(id), "residency.status").value).toBe("citizen_or_green_card");
    expect(await rows(id, "residency.status")).toBe(1);
  });

  it("copies again when something Jane remembers about taxes changed in the chat", async () => {
    const id = await person();
    await household(id);
    await recordFact(
      id,
      { key: "home_state", value: "WA", label: "State: WA", source: "answer" },
      { client },
    );
    expect(fact(await household(id), "home.state").value).toBe("WA");
  });

  it("records the state the row says, not the one a slower save carried", async () => {
    const id = await person();
    await saveTaxAnswers(id, [{ field: "state", value: "CA" }], { ...options, via: "page" });
    await client.taxProfile.update({ where: { userId: id }, data: { state: "NY" } });
    await saveTaxAnswers(id, [{ field: "state", value: "NY" }], { ...options, via: "page" });
    expect(fact(await household(id), "home.state").value).toBe("NY");
  });

  it("reads the working year, and the calendar year too while last year's return is filed", () => {
    expect(taxHouseholdYears("2026-11-27")).toEqual([2026]);
    expect(taxHouseholdYears("2027-04-30")).toEqual([2026, 2027]);
    expect(taxHouseholdYears("2027-05-01")).toEqual([2027]);
  });
});
