import { beforeEach, describe, expect, it } from "vitest";
import type { TaxFactKey } from "@/config/tax-facts";
import { withChildIds } from "@/planning/family-taxes";
import {
  foundRows,
  householdRows,
  isProfileMember,
  legacyRows,
  type LegacySources,
} from "./legacy";

const base: LegacySources = {
  taxYear: 2026,
  today: "2026-11-27",
  filing: null,
  profile: null,
  told: {},
  investor: null,
};

const valueOf = (rows: ReturnType<typeof legacyRows>, key: TaxFactKey, member = "self") =>
  rows.facts.filter((f) => f.key === key && (f.member ?? "self") === member);

describe("copying the older stores into the household record", () => {
  it("copies nothing for a person who has said nothing", () => {
    expect(legacyRows(base)).toEqual({ facts: [], members: [] });
  });

  it("copies how they file as their answer, and the answer that lost beside it", () => {
    const rows = legacyRows({
      ...base,
      filing: { status: "single", replaced: "married_joint", day: "2026-10-01" },
    });
    expect(valueOf(rows, "filing.status")).toEqual([
      expect.objectContaining({ value: "single", origin: "answer", asOf: "2026-10-01" }),
      expect.objectContaining({ value: "married_joint", origin: "legacy" }),
    ]);
  });

  it("copies each told fact to its key, with the day it was told", () => {
    const told = (value: string | number | boolean) => ({ value, day: "2026-09-09" });
    const rows = legacyRows({
      ...base,
      told: {
        claimed_as_dependent: told("no"),
        tax_residency: told("citizen"),
        enrollment: told("undergrad"),
        age: told(25),
        home_state: told("CA"),
      },
    });
    const pick = (key: TaxFactKey) => valueOf(rows, key)[0];
    expect(pick("filing.claimed_as_dependent")).toMatchObject({ value: "no", origin: "answer" });
    expect(pick("residency.status")).toMatchObject({
      value: "citizen_or_green_card",
      origin: "answer",
      asOf: "2026-09-09",
    });
    expect(pick("person.half_time")).toMatchObject({ value: true });
    expect(pick("person.degree_program")).toMatchObject({ value: "undergrad" });
    // 25 on Sep 9, 2026: born in 2000 or 2001 (a year range, inferred, never a made-up date).
    expect(pick("person.birth_date")).toMatchObject({ value: "2000/2001", status: "inferred" });
    expect(pick("home.state")).toMatchObject({ value: "CA", origin: "answer" });
  });

  it("copies an enrollment that is not half time as 'not half time'", () => {
    const rows = legacyRows({
      ...base,
      told: { enrollment: { value: "not_enrolled", day: "2026-09-09" } },
    });
    expect(valueOf(rows, "person.half_time")[0]).toMatchObject({ value: false });
    expect(valueOf(rows, "person.degree_program")).toEqual([]);
  });

  it("leaves out a told value that is not one of the fact's choices", () => {
    const rows = legacyRows({
      ...base,
      told: {
        tax_residency: { value: "martian", day: "2026-09-09" },
        claimed_as_dependent: { value: "maybe", day: "2026-09-09" },
      },
    });
    expect(rows.facts).toEqual([]);
  });

  it("copies the tax profile's answered fields only", () => {
    const profile = {
      answered: ["state"],
      state: "NY",
      childrenUnder17: 3,
      otherDependants: 1,
      familyChildren: [],
      spouseWagesCents: 5_000_000,
      studentYearsBefore: 2,
      studentHalfTime: true,
    };
    const rows = legacyRows({ ...base, profile });
    expect(valueOf(rows, "home.state")[0]).toMatchObject({ value: "NY", origin: "answer" });
    expect(valueOf(rows, "spouse.earned_income")[0]).toMatchObject({ value: 5_000_000 });
    expect(valueOf(rows, "person.postsecondary_years_before")[0]).toMatchObject({ value: 2 });
    expect(valueOf(rows, "person.half_time")[0]).toMatchObject({ value: true, origin: "answer" });
    // Dependants were never answered: the counts in the row are not the person's.
    expect(rows.members).toEqual([]);
    expect(valueOf(rows, "household.dependants_stated")).toEqual([]);
  });

  it("gives one child one birth year whichever year the record is read for", () => {
    const profile = {
      answered: ["dependants"],
      state: null,
      childrenUnder17: 1,
      otherDependants: 0,
      familyChildren: [
        { id: "c_0123456789ab", ageAtYearEnd: 9, hasSsn: true, monthsLivedWithYou: 12 },
      ],
      spouseWagesCents: 4_000_000,
      studentYearsBefore: 1,
      studentHalfTime: true,
    };
    const years = [2025, 2026, 2027].map((taxYear) => legacyRows({ ...base, taxYear, profile }));
    // The family form describes the year being worked on (2026): a child of 9 there is born in 2017.
    for (const rows of years) {
      expect(valueOf(rows, "member.birth_date", "child:c_0123456789ab")[0]).toMatchObject({
        value: "2017",
      });
    }
    // The months at home, the spouse's wages and the student's years belong to that year only.
    const keys = years.map((rows) => rows.facts.map((f) => f.key));
    expect(keys[1]).toEqual(
      expect.arrayContaining([
        "member.months_lived_with_you",
        "spouse.earned_income",
        "person.postsecondary_years_before",
      ]),
    );
    for (const other of [keys[0], keys[2]]) {
      expect(other).not.toContain("member.months_lived_with_you");
      expect(other).not.toContain("spouse.earned_income");
      expect(other).not.toContain("person.half_time");
    }
  });

  it("copies answered dependants as members, the ones with family details with their ages", () => {
    const rows = legacyRows({
      ...base,
      profile: {
        answered: ["dependants"],
        state: null,
        childrenUnder17: 2,
        otherDependants: 1,
        familyChildren: [
          { id: "c_0123456789ab", ageAtYearEnd: 9, hasSsn: true, monthsLivedWithYou: 12 },
        ],
        spouseWagesCents: null,
        studentYearsBefore: null,
        studentHalfTime: null,
      },
    });
    expect(rows.members).toEqual([
      { memberKey: "child:c_0123456789ab", label: "Child 1", relationship: "child" },
      { memberKey: "child:count-2", label: "Child 2", relationship: "child" },
      { memberKey: "relative:count-1", label: "Dependant 1", relationship: "other_relative" },
    ]);
    expect(valueOf(rows, "member.birth_date", "child:c_0123456789ab")[0]).toMatchObject({
      value: "2017",
      status: "inferred",
    });
    expect(valueOf(rows, "member.months_lived_with_you", "child:c_0123456789ab")[0]).toMatchObject({
      value: 12,
    });
    expect(valueOf(rows, "member.ssn_valid_for_work", "child:c_0123456789ab")[0]).toMatchObject({
      value: "yes",
    });
    // The second child has no details: nothing is made up for them.
    expect(valueOf(rows, "member.birth_date", "child:count-2")).toEqual([]);
    expect(valueOf(rows, "household.dependants_stated")[0]).toMatchObject({ value: true });
  });

  it("counts a child with details beyond the number given, and a placeholder age as no age", () => {
    const rows = legacyRows({
      ...base,
      profile: {
        answered: ["dependants"],
        state: null,
        childrenUnder17: 0,
        otherDependants: 0,
        familyChildren: [
          {
            id: "c_0123456789ab",
            ageAtYearEnd: 5,
            ageUnknown: true,
            hasSsn: false,
            monthsLivedWithYou: 7,
          },
        ],
        spouseWagesCents: null,
        studentYearsBefore: null,
        studentHalfTime: null,
      },
    });
    expect(rows.members).toHaveLength(1);
    expect(valueOf(rows, "member.birth_date", "child:c_0123456789ab")).toEqual([]);
    expect(valueOf(rows, "member.ssn_valid_for_work", "child:c_0123456789ab")[0]).toMatchObject({
      value: "no",
    });
  });

  it("counts children entered on the family form even when the counts were never answered", () => {
    const rows = legacyRows({
      ...base,
      profile: {
        answered: [],
        state: null,
        childrenUnder17: 4,
        otherDependants: 2,
        familyChildren: [
          { id: "c_0123456789ab", ageAtYearEnd: 3, hasSsn: true, monthsLivedWithYou: 12 },
        ],
        spouseWagesCents: null,
        studentYearsBefore: null,
        studentHalfTime: null,
      },
    });
    // The counts in the row are not the person's answer; the child they described is.
    expect(rows.members).toEqual([
      { memberKey: "child:c_0123456789ab", label: "Child 1", relationship: "child" },
    ]);
  });

  it("copies 'I have children' as one child, and 'no children' as none", () => {
    const yes = legacyRows({ ...base, told: { has_children: { value: true, day: "2026-09-09" } } });
    expect(yes.members).toHaveLength(1);
    expect(valueOf(yes, "household.dependants_stated")[0]).toMatchObject({ asOf: "2026-09-09" });
    const no = legacyRows({ ...base, told: { has_children: { value: false, day: "2026-09-09" } } });
    expect(no.members).toEqual([]);
    expect(valueOf(no, "household.dependants_stated")[0]).toMatchObject({ value: true });
  });

  it("keeps one current answer per fact: a told state wins, the profile's goes in as the older store's copy", () => {
    const rows = legacyRows({
      ...base,
      profile: {
        answered: ["state"],
        state: "NY",
        childrenUnder17: null,
        otherDependants: null,
        familyChildren: [],
        spouseWagesCents: null,
        studentYearsBefore: null,
        studentHalfTime: null,
      },
      told: { home_state: { value: "CA", day: "2026-09-09" } },
    });
    expect(valueOf(rows, "home.state").map((f) => [f.value, f.origin])).toEqual([
      ["CA", "answer"],
      ["NY", "legacy"],
    ]);
  });

  it("copies the investor profile's age as a year range on the day it was given", () => {
    const rows = legacyRows({ ...base, investor: { age: 40, ageOn: "2025-02-01" } });
    expect(valueOf(rows, "person.birth_date")[0]).toMatchObject({
      value: "1984/1985",
      status: "inferred",
      origin: "legacy",
      asOf: "2025-02-01",
    });
  });

  it("is the same rows each time (member keys are fixed)", () => {
    const s: LegacySources = {
      ...base,
      told: { has_children: { value: true, day: "2026-09-09" } },
    };
    expect(legacyRows(s)).toEqual(legacyRows(s));
  });
});

describe("what Jane found in the accounts", () => {
  it("is inferred, never an answer, and never stored by itself", () => {
    const rows = foundRows(
      {
        income: [],
        state: { code: "WA", from: "your settings" },
        childrenHint: false,
        dependants: { childrenUnder17: 1, otherDependants: 1, from: "the household" },
      },
      2026,
      "2026-11-27",
    );
    expect(rows.facts).toEqual([
      expect.objectContaining({ key: "home.state", value: "WA", status: "inferred" }),
    ]);
    expect(rows.members.map((m) => m.relationship)).toEqual(["child", "other_relative"]);
  });
});

describe("who a member of the household is", () => {
  const kid = (id: string | undefined, age: number) => ({
    ...(id ? { id } : {}),
    ageAtYearEnd: age,
    hasSsn: true,
    monthsLivedWithYou: 12,
  });
  const keysOf = (familyChildren: unknown, childrenUnder17 = 0) =>
    householdRows(
      { childrenUnder17, otherDependants: 0, familyChildren },
      2026,
      "2026-11-27",
    ).members.map((m) => m.memberKey);

  it("keys a child by their id, so removing the first never gives its facts to the next", () => {
    const a = kid("c_aaaaaaaaaaaa", 9);
    const b = kid("c_bbbbbbbbbbbb", 4);
    expect(keysOf([a, b])).toEqual(["child:c_aaaaaaaaaaaa", "child:c_bbbbbbbbbbbb"]);
    expect(keysOf([b])).toEqual(["child:c_bbbbbbbbbbbb"]);
    const withFacts = householdRows(
      { childrenUnder17: 1, otherDependants: 0, familyChildren: [b] },
      2026,
      "2026-11-27",
    );
    expect(
      withFacts.facts.filter((f) => f.key === "member.birth_date").map((f) => [f.member, f.value]),
    ).toEqual([["child:c_bbbbbbbbbbbb", "2022"]]);
  });

  it("puts a child counted but not described after the described ones, and one with no id yet by place", () => {
    expect(keysOf([kid("c_aaaaaaaaaaaa", 9)], 3)).toEqual([
      "child:c_aaaaaaaaaaaa",
      "child:count-2",
      "child:count-3",
    ]);
    expect(keysOf([kid(undefined, 9)])).toEqual(["child:pos-1"]);
  });

  it("knows which keys the profile made, and no other", () => {
    for (const key of ["child:c_0123456789ab", "child:count-2", "child:pos-1", "relative:count-1"])
      expect(isProfileMember(key)).toBe(true);
    for (const key of ["child:found-1", "relative:added-1", "spouse", "child:legacy-1"])
      expect(isProfileMember(key)).toBe(false);
  });
});

describe("an id on each child of the family form", () => {
  let n = 0;
  const make = () => `c_${String(++n).padStart(12, "0")}`;
  beforeEach(() => {
    n = 0;
  });
  const child = { ageAtYearEnd: 9, hasSsn: true, monthsLivedWithYou: 12 };

  it("adds an id to a child that has none and leaves every other byte as it was", () => {
    const stored = [{ ...child, extra: 1 }, "not a child", { ...child, id: "c_aaaaaaaaaaaa" }];
    const out = withChildIds(stored, make);
    expect(out.changed).toBe(true);
    expect(out.children).toEqual([
      { ...child, extra: 1, id: "c_000000000001" },
      "not a child",
      { ...child, id: "c_aaaaaaaaaaaa" },
    ]);
  });

  it("changes nothing when every child has its id, and gives a repeated id a new one", () => {
    const same = [{ ...child, id: "c_aaaaaaaaaaaa" }];
    expect(withChildIds(same, make)).toEqual({ children: same, changed: false });
    const twice = withChildIds([same[0], { ...child, id: "c_aaaaaaaaaaaa" }], make);
    expect(twice.changed).toBe(true);
    expect((twice.children as { id: string }[]).map((c) => c.id)).toEqual([
      "c_aaaaaaaaaaaa",
      expect.stringMatching(/^c_0+\d$/),
    ]);
  });

  it("never hands a child an id another child already has, whichever comes first", () => {
    // The first child has none and the generator's first guess is the second child's id.
    const guesses = ["c_aaaaaaaaaaaa", "c_bbbbbbbbbbbb"];
    const out = withChildIds(
      [child, { ...child, id: "c_aaaaaaaaaaaa" }],
      () => guesses.shift() ?? "c_cccccccccccc",
    );
    expect((out.children as { id: string }[]).map((c) => c.id)).toEqual([
      "c_bbbbbbbbbbbb",
      "c_aaaaaaaaaaaa",
    ]);
  });

  it("reads anything that is not a list as no children", () => {
    expect(withChildIds(null, make)).toEqual({ children: [], changed: false });
    expect(withChildIds({ id: "c_x" }, make).children).toEqual([]);
  });
});
