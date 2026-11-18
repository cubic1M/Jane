import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_WITHHOLDING_DETECTORS } from "./student-withholding";
import { runDetectors } from "./index";

// A federal refund beside a paycheck (suggest-taxes gap pass: an upload showed "IRS TREAS 310 TAX REF"
// for $842 in March and a steady paycheck, and Jane said nothing).

const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "a",
});
const pay = [
  "2026-01-15",
  "2026-03-15",
  "2026-05-15",
  "2026-07-15",
  "2026-09-15",
  "2026-11-13",
].map((d) => tx(d, -210_000, "PAYROLL DEPOSIT BRIGHTPATH LABS PPD", "INCOME_SALARY"));
const person = (rows: ReturnType<typeof tx>[]): ProfileInput => ({
  today: "2026-11-17",
  transactions: [...pay, ...rows],
  accounts: [],
  liabilities: [],
  told: {},
});
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_WITHHOLDING_DETECTORS).find(
    (s) => s.topic === "refund_withholding",
  ) ?? null;

describe("a federal refund beside a paycheck", () => {
  it("says last year's refund in a month's terms, with the W-4 and the IRS's estimator", () => {
    const s = run(
      person([tx("2026-03-18", -84_200, "IRS TREAS 310 TAX REF", "INCOME_TAX_REFUND")]),
    )!;
    expect(s.title).toContain("Your 2025 federal refund was $842.00");
    expect(s.why).toContain("about $70.17 a month");
    expect(s.why).toContain("Form W-4 sets how much your employer withholds");
    expect(s.more?.[0].href).toBe("https://www.irs.gov/individuals/tax-withholding-estimator");
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

  it("starts at $500, and isn't a FEMA payment, a state refund, or last year's", () => {
    expect(
      run(person([tx("2026-03-18", -49_999, "IRS TREAS 310 TAX REF", "INCOME_TAX_REFUND")])),
    ).toBeNull();
    expect(
      run(person([tx("2026-03-18", -50_000, "IRS TREAS 310 TAX REF", "INCOME_TAX_REFUND")])),
    ).not.toBeNull();
    expect(
      run(
        person([
          tx("2026-10-06", -500_000, "FEMA IHP TREAS 310 DISASTER ASSIST", "TRANSFER_IN_DEPOSIT"),
        ]),
      ),
    ).toBeNull();
    expect(
      run(person([tx("2026-05-02", -60_000, "FRANCHISE TAX BD CASTTAXRFD", "INCOME_TAX_REFUND")])),
    ).toBeNull();
    expect(
      run(person([tx("2025-03-18", -84_200, "IRS TREAS 310 TAX REF", "INCOME_TAX_REFUND")])),
    ).toBeNull();
  });

  it("isn't beside a fellowship, or without a paycheck", () => {
    const refund = tx("2026-03-18", -84_200, "IRS TREAS 310 TAX REF", "INCOME_TAX_REFUND");
    expect(
      run(person([refund, tx("2026-10-01", -475_000, "STANFORD UNIV FELLOWSHIP STIPEND", null)])),
    ).toBeNull();
    const noPay: ProfileInput = { ...person([refund]), transactions: [refund] };
    expect(run(noPay)).toBeNull();
  });
});
