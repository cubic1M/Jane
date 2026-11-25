import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { UNEMPLOYMENT_TAX_DETECTORS } from "./unemployment-tax";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (det-05, 6): a pension is taxable income too. With $25,000 a year of pension
// and $10,000 of unemployment, the tax on the benefit is not zero.
const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "a",
});
const monthly = (n: number, cents: number, desc: string, pfc: string) =>
  Array.from({ length: n }, (_, i) =>
    tx(`2026-${String(i + 1).padStart(2, "0")}-05`, -cents, desc, pfc),
  );
const person = (rows: ReturnType<typeof tx>[]): ProfileInput => ({
  today: "2026-11-17",
  transactions: [tx("2026-01-02", 4_000, "SAFEWAY MOUNTAIN VIEW CA", null), ...rows],
  accounts: [],
  liabilities: [],
  told: { home_state: "other" },
});
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, UNEMPLOYMENT_TAX_DETECTORS)[0] ?? null;
const unemployment = monthly(10, 100_000, "CA EDD UI DIRECT DEP", "INCOME_UNEMPLOYMENT");

describe("unemployment pay on top of a pension", () => {
  it("is taxed on top of the pension, not as if it were the only income", () => {
    // $10,000 alone is under the standard deduction: nothing to show.
    expect(run(person(unemployment))).toBeNull();
    const s = run(
      person([
        ...unemployment,
        ...monthly(11, 200_000, "STATE TEACHERS RET", "INCOME_RETIREMENT_PENSION"),
      ]),
    )!;
    expect(s).not.toBeNull();
    // A pension of about $2,000 a month over 10.5 months is near $25,000 a year.
    expect(s.worthCents).toBeGreaterThan(80_000);
    expect(s.worthCents).toBeLessThan(200_000);
  });
});
