import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { forRealAccount } from "@/lib/suggestions";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { missingFacts } from "@/profile/questions";
import { runDetectors } from "./index";
import { grad, undergrad } from "./__fixtures__/students";

// What a thin-data student is offered on a real account (suggest-money lane, 11-18), so a change
// that loses one of these shows here. Each topic's own test says why it fires; this only counts.

// As the scan filters them for a real account (src/lib/suggestions.ts forRealAccount): no
// advice-only topic, and nothing that tells them what to do with their money.
const realTopics = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data })
    .filter((s) => forRealAccount(s))
    .map((s) => s.topic)
    .sort();

describe("a thin-data student's suggestions", () => {
  it("five weeks of one checking account: ten or more suggestions and questions, in five areas", () => {
    const data = undergrad();
    const topics = realTopics(data);
    expect(topics).toEqual(
      expect.arrayContaining([
        "bank_fees",
        "belongings_cover",
        "cheaper_tier",
        "credit_file_start",
        "emergency_fund",
        "phone_plan_cheaper",
        "student_checking",
        "student_discounts",
      ]),
    );
    const questions = missingFacts(buildProfile(data), data).map((c) => c.spec.fact);
    expect(questions).toContain("pays_school_bill");
    // The manager's bar (11-18): ten or more real suggestions or one-tap questions.
    expect(topics.length + questions.length).toBeGreaterThanOrEqual(10);
    // Across at least five areas.
    const areas = new Set(
      runDetectors({ profile: buildProfile(data), data })
        .filter((s) => topics.includes(s.topic))
        .map((s) => s.capability),
    );
    expect(areas.size).toBeGreaterThanOrEqual(5);
  });

  it("a grad who says they're a student: the card paid from cash and Cardinal Care beside a plan", () => {
    expect(realTopics({ ...grad(), told: { is_student: true } })).toEqual(
      expect.arrayContaining([
        "card_from_cash",
        "cardinal_care_check",
        "duplicate_subscription",
        "student_discounts",
      ]),
    );
  });
});
