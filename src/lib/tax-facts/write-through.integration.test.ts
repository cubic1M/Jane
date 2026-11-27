import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The real writer, except where a test makes it fail.
vi.mock("@/lib/tax-facts/write", async (original) => {
  const real = await original<typeof import("@/lib/tax-facts/write")>();
  return { ...real, recordTaxFact: vi.fn(real.recordTaxFact) };
});

import { clearCorrection, correctFact } from "@/lib/profile";
import { saveFamilyDetails } from "@/lib/family-taxes";
import { loadTaxHousehold, taxHouseholdYears } from "@/lib/tax-facts/load";
import { recordTaxFact } from "@/lib/tax-facts/write";
import { recordProfileField } from "@/lib/tax-facts/through";
import { recordFact } from "@/lib/memory/facts";
import { saveTaxAnswers } from "@/lib/tax-profile";
import { fact } from "@/planning/tax-engine/facts";

// Step T9, part 3: every writer of an older store also writes the household record, and none writes
// the older store less than before.

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
  const household = (id: string) => loadTaxHousehold(id, YEAR, { client, now: NOW });
  const told = async (id: string, key: string) =>
    (
      await client.janePreference.findFirst({
        where: { userId: id, kind: "fact", key: `profile:${key}` },
      })
    )?.value;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("records a told fact beside the preference the card saves", async () => {
    const id = await person();
    await household(id); // the first read copies the older answers in; there are none yet
    await correctFact(id, "tax_residency", "student_visa", { client, now: NOW });
    await correctFact(id, "claimed_as_dependent", "no", { client, now: NOW });
    await correctFact(id, "enrollment", "undergrad", { client, now: NOW });
    await correctFact(id, "home_state", "CA", { client, now: NOW });
    // The older store is written as before ...
    expect(await told(id, "tax_residency")).toEqual({ value: "student_visa" });
    expect(await told(id, "home_state")).toEqual({ value: "CA" });
    // ... and the record says the same.
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
    await correctFact(id, "tax_residency", "unsure", { client, now: NOW });
    await correctFact(id, "tax_residency", "citizen", {
      client,
      now: new Date("2026-11-28T18:00:00Z"),
    });
    const rows = await client.taxFact.findMany({ where: { userId: id, key: "residency.status" } });
    expect(rows.map((r) => [r.value, r.supersededAt !== null])).toEqual(
      expect.arrayContaining([
        [{ v: "unsure" }, true],
        [{ v: "citizen_or_green_card" }, false],
      ]),
    );
  });

  it("takes a fact back when the person takes it back", async () => {
    const id = await person();
    await correctFact(id, "tax_residency", "other_visa", { client, now: NOW });
    expect(await clearCorrection(id, "tax_residency", { client, now: NOW })).toBe(true);
    expect(await told(id, "tax_residency")).toBeUndefined();
    expect(fact(await household(id), "residency.status").status).toBe("unknown");
  });

  it("keeps how they file the same on the card, the tax profile and the record", async () => {
    const id = await person();
    await correctFact(id, "filing_status", "single", { client, now: NOW });
    expect(fact(await household(id), "filing.status").value).toBe("single");
    // The tax profile's form says something else, later.
    await saveTaxAnswers(id, [{ field: "filingStatus", value: "married_joint" }], {
      client,
      now: new Date("2026-11-27T19:00:00Z"),
      via: "page",
    });
    const profile = await client.taxProfile.findUniqueOrThrow({ where: { userId: id } });
    expect(profile).toMatchObject({ filingStatus: "married_joint" });
    expect(profile.answered).toContain("filingStatus");
    expect(await told(id, "filing_status")).toMatchObject({ value: "married_joint" });
    expect(fact(await household(id), "filing.status").value).toBe("married_joint");
    // Taking the card's answer back takes the profile's copy back too, and the record's.
    await clearCorrection(id, "filing_status", { client, now: NOW });
    expect(fact(await household(id), "filing.status").status).toBe("unknown");
  });

  it("records the state and the household the tax profile's form saves", async () => {
    const id = await person();
    await saveTaxAnswers(
      id,
      [
        { field: "state", value: "NY" },
        { field: "dependants", childrenUnder17: 2, otherDependants: 1 },
      ],
      { client, now: NOW, via: "page" },
    );
    let h = await household(id);
    expect(fact(h, "home.state")).toMatchObject({ value: "NY", origin: "answer" });
    expect(fact(h, "household.dependants_stated").value).toBe(true);
    expect(h.members.map((m) => m.key)).toEqual([
      "child:legacy-1",
      "child:legacy-2",
      "relative:legacy-1",
    ]);
    // Fewer dependants: the ones no longer counted are removed from the household, not deleted.
    await saveTaxAnswers(id, [{ field: "dependants", childrenUnder17: 1, otherDependants: 0 }], {
      client,
      now: NOW,
      via: "chat",
    });
    h = await household(id);
    expect(h.members.map((m) => m.key)).toEqual(["child:legacy-1"]);
    expect(await client.taxHouseholdMember.count({ where: { userId: id } })).toBe(3);
    // More again: the removed one comes back under its own key.
    await saveTaxAnswers(id, [{ field: "dependants", childrenUnder17: 2, otherDependants: 0 }], {
      client,
      now: NOW,
      via: "chat",
    });
    expect((await household(id)).members.map((m) => m.key)).toEqual([
      "child:legacy-1",
      "child:legacy-2",
    ]);
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
      { client, now: NOW, via: "page" },
    );
    let h = await household(id);
    expect(fact(h, "spouse.earned_income").value).toBe(4_000_000);
    expect(fact(h, "person.postsecondary_years_before").value).toBe(2);
    expect(fact(h, "person.half_time").value).toBe(true);
    expect(fact(h, "member.birth_date", "child:legacy-1").value).toBe("2020");
    expect(h.members).toHaveLength(1);
    // Cleared on the form: cleared on the record.
    await saveFamilyDetails(
      id,
      { children: [], spouseWagesCents: null, paysOverHalfHome: null, student: null },
      { client, now: NOW, via: "page" },
    );
    h = await household(id);
    expect(fact(h, "spouse.earned_income").status).toBe("unknown");
    expect(fact(h, "person.half_time").status).toBe("unknown");

    const other = await person();
    await correctFact(other, "has_children", "yes", { client, now: NOW });
    expect((await household(other)).members).toHaveLength(1);
    expect(
      (await client.taxProfile.findUniqueOrThrow({ where: { userId: other } })).childrenUnder17,
    ).toBe(1);
  });

  it("gives way to what Jane remembers from the chat when a card's answer is taken back", async () => {
    const id = await person();
    await recordFact(
      id,
      { key: "home_state", value: "WA", label: "State: WA", source: "chat" },
      { client },
    );
    await correctFact(id, "home_state", "OR", { client, now: NOW });
    expect(fact(await household(id), "home.state").value).toBe("OR");
    await clearCorrection(id, "home_state", { client, now: NOW });
    expect(fact(await household(id), "home.state").value).toBe("WA");
  });

  it("finishes taking an answer off the record when taking it back is tried again", async () => {
    const id = await person();
    await correctFact(id, "tax_residency", "other_visa", { client, now: NOW });
    // The preference goes but the record's cleanup never ran (say the database blinked): the person
    // takes the answer back again, though there is nothing left to delete.
    await client.janePreference.deleteMany({ where: { userId: id, key: "profile:tax_residency" } });
    await client.userFact.deleteMany({ where: { userId: id, key: "tax_residency" } });
    expect(fact(await household(id), "residency.status").value).toBe("other_visa");
    expect(await clearCorrection(id, "tax_residency", { client, now: NOW })).toBe(false);
    expect(fact(await household(id), "residency.status").status).toBe("unknown");
  });

  it("takes off a child's details the form no longer has, and never gives them to the next child", async () => {
    const id = await person();
    const child = (age: number) => ({ ageAtYearEnd: age, hasSsn: true, monthsLivedWithYou: 12 });
    const save = (children: ReturnType<typeof child>[], counted?: number) =>
      saveFamilyDetails(
        id,
        { children, spouseWagesCents: null, paysOverHalfHome: null, student: null },
        { client, now: NOW, via: "page" },
      ).then(() =>
        counted === undefined
          ? undefined
          : saveTaxAnswers(
              id,
              [{ field: "dependants", childrenUnder17: counted, otherDependants: 0 }],
              {
                client,
                now: NOW,
                via: "page",
              },
            ),
      );
    await save([child(9), child(4)], 2);
    let h = await household(id);
    expect(fact(h, "member.birth_date", "child:legacy-1").value).toBe("2017");
    expect(fact(h, "member.birth_date", "child:legacy-2").value).toBe("2022");
    // The form no longer lists the children, though two are still counted: the details go.
    await save([]);
    h = await household(id);
    expect(h.members).toHaveLength(2);
    for (const member of ["child:legacy-1", "child:legacy-2"]) {
      expect(fact(h, "member.birth_date", member).status).toBe("unknown");
      expect(fact(h, "member.months_lived_with_you", member).status).toBe("unknown");
    }
    // One child with no age given: nothing of the first child's remains on that one.
    await save([{ ...child(9), ageUnknown: true } as ReturnType<typeof child>], 1);
    h = await household(id);
    expect(h.members.map((m) => m.key)).toEqual(["child:legacy-1"]);
    expect(fact(h, "member.birth_date", "child:legacy-1").status).toBe("unknown");
  });

  it("records the state the row says, not the one a slower save carried", async () => {
    const id = await person();
    await saveTaxAnswers(id, [{ field: "state", value: "CA" }], { client, now: NOW, via: "page" });
    // Another save made the row say NY while the first was still finishing: the first's record write
    // then runs, and it reads the row.
    await client.taxProfile.update({ where: { userId: id }, data: { state: "NY" } });
    await recordProfileField(id, "state", { client, now: NOW });
    expect(fact(await household(id), "home.state").value).toBe("NY");
  });

  it("does not undo or fail an answer when the record cannot be written", async () => {
    const id = await person();
    vi.mocked(recordTaxFact).mockRejectedValueOnce(new Error("the database blinked"));
    await expect(
      correctFact(id, "tax_residency", "citizen", { client, now: NOW }),
    ).resolves.toBeUndefined();
    expect(await told(id, "tax_residency")).toEqual({ value: "citizen" });
    // The older store still has it, and the record reads it from there on its first read.
    expect(fact(await household(id), "residency.status").value).toBe("citizen_or_green_card");
  });

  it("reads the working year, and the calendar year too while last year's return is filed", () => {
    expect(taxHouseholdYears("2026-11-27")).toEqual([2026]);
    expect(taxHouseholdYears("2027-04-30")).toEqual([2026, 2027]);
    expect(taxHouseholdYears("2027-05-01")).toEqual([2027]);
    expect(taxHouseholdYears("2027-01-01")).toEqual([2026, 2027]);
  });
});
