import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { ADVICE_TOPICS } from "@/config/suggestions";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { runDetectors } from "./index";
import { grad, undergrad } from "./__fixtures__/students";

// What a thin-data student is offered on a real account (suggest-money lane, 11-18), so a change
// that loses one of these shows here. Each topic's own test says why it fires; this only counts.

const realTopics = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data })
    .map((s) => s.topic)
    .filter((t) => !(ADVICE_TOPICS as readonly string[]).includes(t))
    .sort();

describe("a thin-data student's suggestions", () => {
  it("five weeks of one checking account: fees, a cushion, student plans, a credit file", () => {
    expect(realTopics(undergrad())).toEqual(
      expect.arrayContaining([
        "bank_fees",
        "credit_file_start",
        "emergency_fund",
        "student_checking",
        "student_discounts",
      ]),
    );
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
