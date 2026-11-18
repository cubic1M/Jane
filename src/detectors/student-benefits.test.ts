import { describe, expect, it, vi } from "vitest";
import { tellsThemToAct } from "@/lib/real-account-text";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { HEADLINE_VERBS } from "@/config/detectors";
import { AID_PRIORITY, CLIPPER_START } from "@/config/student-money";
import { PEOPLE } from "@/config/people";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HEADLINE_MAX, SHORT_MAX, type Suggestion } from "./contract";
import { runDetectors } from "./index";
import { STUDENT_BENEFIT_DETECTORS } from "./student-benefits";
import { undergrad } from "./__fixtures__/students";

// Suggest-money lane (11-18): Clipper START's half-price fares and Stanford's aid priority date.

const fire = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_BENEFIT_DETECTORS).find(
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
    // Real-account text never tells them what to do with money (src/lib/real-account-text.ts).
    expect(tellsThemToAct(text), text).toBe(false);
  }
  expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  expect(HEADLINE_VERBS, s.headline).toContain(s.headline.split(" ")[0]);
  expect(s.short.length).toBeLessThanOrEqual(SHORT_MAX);
}

const row = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "ug-checking",
});

// The undergraduate (about $825 a month from a campus job) riding Caltrain and BART.
const riding = (n: number, over: Partial<ProfileInput> = {}): ProfileInput => {
  const base = undergrad();
  return {
    ...base,
    transactions: [
      ...base.transactions,
      ...Array.from({ length: n }, (_, i) =>
        row(
          `2026-11-${String(2 + i).padStart(2, "0")}`,
          i % 2 ? 450 : 620,
          i % 2 ? "CALTRAIN MOBILE TICKET" : "BART CLIPPER",
          "TRANSPORTATION_PUBLIC_TRANSIT",
        ),
      ),
    ],
    ...over,
  };
};

describe("Clipper START", () => {
  it("halves a year of the fares seen, for income under the one-person limit", () => {
    const s = fire(riding(6), "clipper_start")!;
    expect(s).not.toBeNull();
    expect(s.why).toContain("$31,920");
    expect(s.why).toContain("aged 19 to 64");
    expect(s.why).toContain("a parent's return");
    expect(s.action.href).toBe(CLIPPER_START.applyUrl);
    expect(s.confidence.percent).toBeLessThanOrEqual(55);
    expectClean(s);
  });

  it("is nothing over the limit, outside California, outside the ages, or under three fares", () => {
    expect(fire(riding(6, { told: { monthly_income: 270_000 } }), "clipper_start")).toBeNull();
    // $2,660 a month is $31,920 a year: at the limit, it applies.
    expect(fire(riding(6, { told: { monthly_income: 266_000 } }), "clipper_start")).not.toBeNull();
    expect(fire(riding(6, { state: "NY" }), "clipper_start")).toBeNull();
    expect(fire(riding(6, { told: { age: 18 } }), "clipper_start")).toBeNull();
    expect(fire(riding(6, { told: { age: 65 } }), "clipper_start")).toBeNull();
    expect(fire(riding(6, { told: { age: 19 } }), "clipper_start")).not.toBeNull();
    expect(fire(riding(2), "clipper_start")).toBeNull();
    expect(fire(riding(3), "clipper_start")).not.toBeNull();
  });

  it("uses the household's limit: two people may have $43,280", () => {
    const s = fire(
      riding(6, { householdSize: 2, told: { monthly_income: 340_000 } }),
      "clipper_start",
    )!;
    expect(s.why).toContain("$43,280");
    expect(s.why).toContain("2 people");
  });
});

describe("Stanford's aid priority date", () => {
  const withAid = (today: string): ProfileInput => {
    const base = undergrad();
    return {
      ...base,
      today,
      transactions: [
        ...base.transactions,
        row("2026-09-24", -125_000, "STANFORD UNIV STUDENT REFUND", "TRANSFER_IN_DEPOSIT"),
      ],
    };
  };

  it("names next year's forms, codes and date for an undergraduate getting aid", () => {
    const s = fire(withAid("2027-03-01"), "aid_priority_date")!;
    expect(s).not.toBeNull();
    expect(s.title).toContain("April 30, 2027");
    expect(s.why).toContain(AID_PRIORITY.cssCode);
    expect(s.why).toContain(AID_PRIORITY.fafsaCode);
    expect(s.short).toContain("$1,250.00");
    expectClean(s);
  });

  it("is said from 75 days before and not after the date, and only with aid seen", () => {
    // Apr 30 is 75 days after Feb 14.
    expect(fire(withAid("2027-02-14"), "aid_priority_date")).not.toBeNull();
    expect(fire(withAid("2027-02-13"), "aid_priority_date")).toBeNull();
    expect(fire(withAid("2027-04-30"), "aid_priority_date")!.urgency).toBe("now");
    expect(fire(withAid("2027-05-01"), "aid_priority_date")).toBeNull();
    expect(fire({ ...undergrad(), today: "2027-03-01" }, "aid_priority_date")).toBeNull();
  });
});

describe("the sample people", () => {
  it("get none of these", () => {
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      const fired = runDetectors({ profile: buildProfile(data), data }, STUDENT_BENEFIT_DETECTORS);
      expect(fired.map((s) => `${p.id}:${s.topic}`)).toEqual([]);
    }
  });
});
