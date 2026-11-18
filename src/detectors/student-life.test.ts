import { describe, expect, it, vi } from "vitest";
import { HEADLINE_VERBS } from "@/config/detectors";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CARDINAL_CARE, GRAD_GOPASS, STANFORD_FREE } from "@/config/student-money";
import { PEOPLE } from "@/config/people";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { missingFacts } from "@/profile/questions";
import { inputFor } from "@/profile/sample";
import { HEADLINE_MAX, SHORT_MAX, type Suggestion } from "./contract";
import { runDetectors } from "./index";
import { STUDENT_LIFE_DETECTORS } from "./student-life";
import { grad, undergrad } from "./__fixtures__/students";

// Suggest-money lane (11-18): what Stanford gives free, the grad Caltrain pass, Cardinal Care
// beside another health plan, two plans on one phone, and the question that unlocks them.

const fire = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_LIFE_DETECTORS).find(
    (s) => s.topic === topic,
  ) ?? null;

function expectClean(s: Suggestion) {
  for (const text of [s.title, s.headline, s.short, s.why]) {
    expect(
      checkGuardrails(
        text,
        dollarFigures(text).map((f) => f.cents),
      ),
      text,
    ).toEqual({
      ok: true,
    });
    expect(recommendsAChoice(text), text).toBe(false);
  }
  expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  expect(HEADLINE_VERBS, s.headline).toContain(s.headline.split(" ")[0]);
  expect(s.short.length).toBeLessThanOrEqual(SHORT_MAX);
}

const add = (data: ProfileInput, ...rows: [string, number, string, string?][]): ProfileInput => ({
  ...data,
  transactions: [
    ...data.transactions,
    ...rows.map(([date, amountCents, description, pfc]): ProfileTx => ({
      date,
      amountCents,
      description,
      pfc: pfc ?? "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      accountId: data.accounts[0]!.id,
    })),
  ],
});

const gradStudent = (): ProfileInput => ({ ...grad(), told: { is_student: true } });

describe("what Stanford gives its people free", () => {
  it("names each paid service, Stanford's way to get it, and a year of what it costs", () => {
    const data = add(
      undergrad(),
      ["2026-10-20", 2_500, "NYTIMES*NYTDIGITAL"],
      ["2026-11-17", 2_500, "NYTIMES*NYTDIGITAL"],
      ["2026-11-02", 9_999, "MICROSOFT*365 PERSONAL"],
    );
    const s = fire(data, "free_through_school")!;
    expect(s).not.toBeNull();
    // $25 a month, and $99.99 once (a year's).
    expect(s.worthCents).toBe(2_500 * 12 + 9_999);
    expect(s.title).toContain("The New York Times and Microsoft 365");
    expect(s.why).toContain("accessnyt.com");
    expect(s.why).toContain("cancel the paid one first");
    // A fact about the paid plan, not an instruction to drop it.
    expect(s.why).toContain("keeps charging until it's cancelled in its own account");
    expect(s.title).not.toMatch(/instead of paying/);
    expect(s.action.href).toBe(STANFORD_FREE[0].url);
    expect(s.watch).toMatchObject({ kind: "charge_stops" });
    expectClean(s);
  });

  it("knows Zoom by its billing names", () => {
    const s = fire(
      add(undergrad(), ["2026-11-10", 1_599, "ZOOM.US 888-799-9666"]),
      "free_through_school",
    )!;
    expect(s.title).toContain("Zoom");
    expect(
      fire(add(undergrad(), ["2026-11-10", 1_599, "ZOOMIES PET CARE"]), "free_through_school"),
    ).toBeNull();
  });

  it("reads one small charge as monthly, and leaves out NYT Games and Cooking", () => {
    const one = fire(
      add(undergrad(), ["2026-11-10", 400, "WASHINGTON POST"]),
      "free_through_school",
    )!;
    expect(one.worthCents).toBe(400 * 12);
    expect(
      fire(add(undergrad(), ["2026-11-10", 600, "NYTIMES GAMES"]), "free_through_school"),
    ).toBeNull();
  });

  it("reaches a grad paid by Stanford even before they say they're a student", () => {
    const s = fire(add(grad(), ["2026-11-03", 1_000, "WSJ DIGITAL"]), "free_through_school");
    expect(s).not.toBeNull();
  });

  it("is nothing for someone with no Stanford in their data, or a charge over 400 days old", () => {
    const elsewhere = add(
      {
        ...undergrad(),
        transactions: undergrad().transactions.filter((t) => !/STANFORD/.test(t.description)),
      },
      ["2026-11-10", 2_500, "NYTIMES*NYTDIGITAL"],
    );
    expect(fire(elsewhere, "free_through_school")).toBeNull();
    expect(
      fire(add(undergrad(), ["2025-10-13", 2_500, "NYTIMES*NYTDIGITAL"]), "free_through_school"),
    ).toBeNull();
    expect(
      fire(add(undergrad(), ["2025-10-14", 2_500, "NYTIMES*NYTDIGITAL"]), "free_through_school"),
    ).not.toBeNull();
  });
});

describe("the free Caltrain pass for graduate students", () => {
  const fares = (data: ProfileInput, n: number) =>
    add(
      data,
      ...Array.from({ length: n }, (_, i): [string, number, string, string] => [
        `2026-11-${String(2 + i).padStart(2, "0")}`,
        450,
        "CALTRAIN MOBILE TICKET",
        "TRANSPORTATION_PUBLIC_TRANSIT",
      ]),
    );

  it("prices the fares a year and gives the form, saying who it's for", () => {
    const s = fire(fares(gradStudent(), 8), "transit_pass")!;
    expect(s).not.toBeNull();
    expect(s.short).toContain("$36.00 in 8 Caltrain fares");
    expect(s.why).toContain("94304, 94305 or 94309");
    expect(s.why).toContain("Undergraduates aren't eligible");
    expect(s.action.href).toBe(GRAD_GOPASS.formUrl);
    expect(s.confidence.percent).toBeLessThanOrEqual(55);
    expectClean(s);
  });

  it("needs two fares, a student at Stanford, and the program still running", () => {
    expect(fire(fares(gradStudent(), 1), "transit_pass")).toBeNull();
    expect(fire(fares(gradStudent(), 2), "transit_pass")).not.toBeNull();
    expect(fire(fares(grad(), 8), "transit_pass")).toBeNull();
    expect(fire({ ...fares(gradStudent(), 8), today: "2027-09-01" }, "transit_pass")).toBeNull();
  });
});

describe("Cardinal Care beside another health plan", () => {
  it("says what Cardinal Care costs, the waiver rules and the window open now", () => {
    const s = fire(gradStudent(), "cardinal_care_check")!;
    expect(s).not.toBeNull();
    // Facts on two plans, not a saving: no figure, no nudge, and the choice left to them
    // (chat-tests wording check, 11-18).
    expect(s.worthCents).toBe(0);
    expect(s.title).not.toMatch(/^Check you/);
    expect(s.why).toContain("Whether to keep both plans is yours to decide");
    expect(s.why).toContain("I can't compare what the two plans cover");
    expect(s.why).toContain("allows a waiver for another plan");
    expect(s.why).toContain("$8,808");
    expect(s.why).toContain("$10,600");
    expect(s.why).toContain("students starting in winter: Nov 18 to December 15");
    expect(s.urgency).toBe("now");
    expect(s.confidence.percent).toBeLessThanOrEqual(40);
    expect(s.more?.[0]?.href).toBe(CARDINAL_CARE.costUrl);
    expectClean(s);
  });

  it("is later once the window has closed, naming the next one", () => {
    const after = fire({ ...gradStudent(), today: "2026-12-20" }, "cardinal_care_check")!;
    expect(after.urgency).toBe("later");
    expect(after.why).toContain("students starting in spring");
  });

  it("is nothing without a health premium, for a doctor's bill, or for a non-student", () => {
    const none = {
      ...gradStudent(),
      transactions: gradStudent().transactions.filter((t) => !/BLUE SHIELD/.test(t.description)),
    };
    expect(fire(none, "cardinal_care_check")).toBeNull();
    const visit = add(none, [
      "2026-11-10",
      4_000,
      "KAISER PERMANENTE CLINIC",
      "MEDICAL_PRIMARY_CARE",
    ]);
    expect(fire(visit, "cardinal_care_check")).toBeNull();
    expect(fire({ ...grad(), told: { is_student: false } }, "cardinal_care_check")).toBeNull();
  });
});

describe("two plans protecting one phone", () => {
  it("says what's paid and where each plan is managed, with no saving and no cancel", () => {
    const data = add(
      undergrad(),
      ["2026-10-05", 1_349, "APPLECARE+ MONTHLY"],
      ["2026-11-05", 1_349, "APPLECARE+ MONTHLY"],
      ["2026-11-08", 1_800, "ASURION WIRELESS PROTECTION"],
    );
    const s = fire(data, "device_cover_twice")!;
    expect(s.worthCents).toBe(0);
    expect(s.watch).toBeUndefined();
    expect(s.why).toContain("about $377.88 a year for the two");
    expect(s.why).toContain("I can't see which device each covers");
    expect(s.why).not.toMatch(/cancel|keeps the phone covered/i);
    expectClean(s);
  });

  it("is nothing with one plan, or with the other one stopped over 75 days ago", () => {
    expect(
      fire(add(undergrad(), ["2026-11-05", 1_349, "APPLECARE+ MONTHLY"]), "device_cover_twice"),
    ).toBeNull();
    expect(
      fire(
        add(undergrad(), ["2026-11-05", 1_349, "APPLECARE+"], ["2026-09-03", 1_800, "ASURION"]),
        "device_cover_twice",
      ),
    ).toBeNull();
  });
});

describe("the question that unlocks them", () => {
  it("is asked of someone paid by a university with nothing else saying school", () => {
    const data = grad();
    const profile = buildProfile(data);
    expect(profile.facts.is_student.value).toBeNull();
    expect(missingFacts(profile, data).map((c) => c.spec.fact)).toContain("is_student");
  });

  it("isn't asked when campus spending already says student, or nothing says university", () => {
    const ug = undergrad();
    expect(buildProfile(ug).facts.is_student.value).toBe(true);
    expect(missingFacts(buildProfile(ug), ug).map((c) => c.spec.fact)).not.toContain("is_student");
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      expect(missingFacts(buildProfile(data), data).map((c) => c.spec.fact)).not.toContain(
        "is_student",
      );
    }
  });
});

describe("the sample people", () => {
  it("get none of these", () => {
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      const fired = runDetectors({ profile: buildProfile(data), data }, STUDENT_LIFE_DETECTORS);
      expect(fired.map((s) => `${p.id}:${s.topic}`)).toEqual([]);
    }
  });
});
