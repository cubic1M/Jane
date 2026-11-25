import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { UNEMPLOYMENT_TAX_DETECTORS } from "./unemployment-tax";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (PR #2268): the year's pension is paced over the months the statements
// cover. With statements that stop in March and today in November, the months since March hold no
// rows to pace over, so the pension read as a quarter of its real pace and the tax came out low.
const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "a",
});
const monthly = (months: number, cents: number, desc: string, pfc: string) =>
  Array.from({ length: months }, (_, i) =>
    tx(`2026-${String(i + 1).padStart(2, "0")}-05`, -cents, desc, pfc),
  );
const run = (today: string) => {
  const data: ProfileInput = {
    today,
    transactions: [
      tx("2026-01-02", 4_000, "SAFEWAY MOUNTAIN VIEW CA", null),
      ...monthly(3, 300_000, "CA EDD UI DIRECT DEP", "INCOME_UNEMPLOYMENT"),
      ...monthly(3, 200_000, "STATE TEACHERS RET", "INCOME_RETIREMENT_PENSION"),
    ],
    accounts: [],
    liabilities: [],
    told: { home_state: "other" },
  };
  return runDetectors({ profile: buildProfile(data), data }, UNEMPLOYMENT_TAX_DETECTORS)[0] ?? null;
};

describe("the pension pace when the statements stop before today", () => {
  it("is the same a week after the last row as eight months after it", () => {
    const soon = run("2026-03-12");
    expect(soon).not.toBeNull();
    const late = run("2026-11-17");
    expect(late).not.toBeNull();
    expect(late!.worthCents).toBe(soon!.worthCents);
  });
});
