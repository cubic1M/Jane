import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { federalTaxOf } from "@/planning/student-tax";
import { UNEMPLOYMENT_TAX_DETECTORS } from "./unemployment-tax";
import { runDetectors } from "./index";

// Unemployment pay (suggest-taxes gap pass): federal income, withheld only on a W-4V's 10%, not taxed
// by California.

const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "a",
});
const weeks = (n: number, cents: number) =>
  Array.from({ length: n }, (_, i) =>
    tx(
      `2026-${String(7 + Math.floor(i / 4)).padStart(2, "0")}-${String(3 + (i % 4) * 7).padStart(2, "0")}`,
      -cents,
      "CA EDD UI DIRECT DEP",
      "INCOME_UNEMPLOYMENT",
    ),
  );
const person = (rows: ReturnType<typeof tx>[], told: Told = {}): ProfileInput => ({
  today: "2026-11-17",
  transactions: [tx("2026-07-01", 4_000, "SAFEWAY MOUNTAIN VIEW CA", null), ...rows],
  accounts: [],
  liabilities: [],
  told: { home_state: "CA", ...told },
});
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, UNEMPLOYMENT_TAX_DETECTORS)[0] ?? null;

describe("unemployment pay", () => {
  it("is federal income above the standard deduction, untaxed by California, withheld only at 10% by choice", () => {
    // 16 weeks of $450 is $7,200; with nothing else, under $16,100: no tax.
    expect(run(person(weeks(16, 45_000)))).toBeNull();
    // 19 weeks of $1,000 by today is $19,000: $2,900 over the $16,100 deduction, at 10%.
    const s = run(person(weeks(19, 100_000)))!;
    expect(s.worthCents).toBe(29_000);
    expect(s.worthCents).toBe(federalTaxOf(1_900_000, "single", false));
    expect(s.why).toContain("IRS Topic 418");
    expect(s.why).toContain("at 10% of each payment");
    expect(s.why).toContain("California doesn't tax it (FTB)");
    for (const t of [s.title, s.headline, s.short, s.why]) {
      expect(
        checkGuardrails(
          t,
          dollarFigures(t).map((f) => f.cents),
        ),
        t,
      ).toEqual({ ok: true });
      expect(tellsThemToAct(t), t).toBe(false);
      expect(recommendsAChoice(t), t).toBe(false);
    }
  });

  it("leaves California out for someone elsewhere, and says nothing without unemployment pay", () => {
    expect(run(person(weeks(19, 100_000), { home_state: "other" }))!.why).not.toContain(
      "California",
    );
    expect(run(person([]))).toBeNull();
    // Paid family leave isn't unemployment pay.
    expect(
      run(person([tx("2026-08-01", -900_000, "EDD PFL DIRECT DEP", "INCOME_OTHER")])),
    ).toBeNull();
  });
});
