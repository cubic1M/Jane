import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_TAX_DETECTORS } from "./student-taxes";
import { STUDENT_TODAY } from "./__fixtures__/student-walk";

// CodeRabbit sweep 1c, PR 2266 (comment 4695930906): one deposit that says "fellowship" beside one
// that only says "refund" doesn't make the combined amount a confirmed fellowship; the wording
// stays conditional until every deposit counted says what it is, or the person says so.

const tx = (date: string, amountCents: number, description: string) => ({
  date,
  amountCents,
  description,
  pfc: null,
  accountId: "checking",
});
const student = (deposits: ReturnType<typeof tx>[], told: Told = {}) =>
  ({
    today: STUDENT_TODAY,
    transactions: [
      ...["2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"].map((d) => ({
        ...tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA"),
        pfc: "FOOD_AND_DRINK_GROCERIES",
      })),
      ...deposits,
    ],
    accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 }],
    liabilities: [],
    told,
  }) as ProfileInput;
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_TAX_DETECTORS).find(
    (s) => s.topic === "stipend_tax",
  )!;

const named = tx("2026-11-02", -475_000, "STANFORD UNIV FELLOWSHIP STIPEND PPD ID: 1946001");
const refund = tx("2026-10-02", -475_000, "STANFORD UNIV STUDENT ACCT REFUND PPD ID: 1946001");

describe("the fellowship tax card with mixed school deposits", () => {
  it("keeps title, headline and short conditional when only some deposits are named", () => {
    const s = run(student([named, refund]));
    expect(s).toBeDefined();
    expect(s.title).toMatch(/^If these school deposits are a fellowship/);
    expect(s.headline).toContain("if this is a fellowship");
    expect(s.short).toContain("if it's a fellowship");
  });

  it("keeps the plain wording when every deposit is named", () => {
    const s = run(
      student([named, tx("2026-10-02", -475_000, "STANFORD UNIV FELLOWSHIP STIPEND PPD ID: 1")]),
    );
    expect(s.title).toMatch(/^Nothing is withheld from your fellowship/);
  });

  it("keeps the plain wording when the person says it's a fellowship", () => {
    const s = run(student([named, refund], { school_deposit: "fellowship" }));
    expect(s.title).toMatch(/^Nothing is withheld from your fellowship/);
  });
});
