import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProfile, type Told } from "@/profile/build";
import { STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { SIDE_INCOME_DETECTORS } from "./side-income";
import { runDetectors } from "./index";

// CodeRabbit sweep 1b: "mixed" payment-app money (work and friends' repayments) was counted
// whole as work income.
const walk = async (told: Told = {}) => {
  const data = await inputFromStatements(
    [{ name: "checking.csv", text: readFileSync("e2e/fixtures/messy/checking.csv", "utf8") }],
    STUDENT_TODAY,
    told,
  );
  return runDetectors({ profile: buildProfile(data), data }, SIDE_INCOME_DETECTORS)[0]!;
};

describe("payment-app money the person calls mixed", () => {
  it("is left out of the figure and says why, like unanswered", async () => {
    const plain = await walk();
    const mixed = await walk({ app_income: "mixed" });
    const work = await walk({ app_income: "work" });
    expect(mixed.worthCents).toBe(plain.worthCents);
    expect(mixed.why).toMatch(/mixed, and I can't tell which part is work/);
    expect(work.worthCents).toBeGreaterThan(mixed.worthCents);
  });
});
